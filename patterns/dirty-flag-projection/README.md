# Dirty-Flag Projection

> Prevent projection write amplification by setting a dirty flag in handlers and
> flushing in the main loop — five rapid mutations produce one Elasticsearch write
> instead of five.

## Problem

An entity workflow that projects its state into a search index has to decide *when* to
write. The obvious place is the update handler — mutate, then `await indexCart(...)` —
and it has three problems:

1. **Write amplification.** A shopper clicking "+" five times produces five index writes
   carrying five nearly identical documents. Under load the projection store, not the
   workflow, becomes the bottleneck.

2. **Out-of-order writes.** Handlers interleave. Handler A mutates to state S₁ and awaits
   its index write; handler B runs, mutates to S₂, and awaits *its* write. If A's write
   lands after B's, the index holds S₁ — stale — and nothing will correct it until the next
   mutation.

3. **Slow, fragile responses.** Every update caller waits for an index round trip, and an
   index outage turns every mutation into an error — even though the entity's own state is
   fine.

## Solution

Handlers **mutate and mark**; one place **flushes**:

- Every handler that changes state sets `dirty = true` and returns immediately.
- The main loop waits on `condition(() => dirty || done)`, clears the flag, builds the
  document from the *current* state, and writes it — one write per burst, always the
  latest state, writes serialized by the loop so they cannot reorder.
- The loop also flushes on the way out: before `continueAsNew` and before returning.

```mermaid
sequenceDiagram
    participant C as Client
    participant H as addItem handler
    participant L as Main loop
    participant ES as Search index
    C->>H: addItem ×5 (rapid)
    H->>H: mutate state, dirty = true (×5)
    H-->>C: new state (×5, immediate)
    L->>L: condition(() => dirty) wakes
    L->>L: dirty = false; doc = build(state)
    L->>ES: index(doc) — one write, latest state
```

### Rules

1. **Clear the flag *before* the write, not after.** A mutation that arrives while the
   write is in flight sets `dirty` again and is picked up by the next iteration. Clearing
   after the write would lose it.

2. **The write reads current state, not a snapshot captured by the handler.** That is what
   makes the last write the latest state.

3. **Projection failure must not fail the entity.** The activity retries; if it exhausts,
   log, leave `dirty` set (or set it again), and let the next iteration try. The entity's
   state in the workflow is authoritative; the projection is repairable.

4. **Flush at every exit.** Terminal state and `continueAsNew` both pass through a final
   flush, or the last burst is never projected.

5. **Optionally, wait for quiet.** `await sleep('100 ms')` after waking coalesces a burst
   that is still arriving. Usually unnecessary — the index round trip itself is the
   coalescing window — but it is one line if measurements say otherwise.

## Example

```typescript file=activities.ts
import type { CartDocument } from './document';
export interface CartActivities {
  indexCart(doc: CartDocument): Promise<void>;
}
```

```typescript file=document.ts
import type { CartState } from './workflows';

/** What the search index stores — see the Document Builder pattern. */
export interface CartDocument {
  cartId: string;
  itemCount: number;
  skus: string[];
  updatedAt: string;
}

export function buildCartDocument(state: CartState): CartDocument {
  return {
    cartId: state.cartId,
    itemCount: Object.values(state.items).reduce((n, q) => n + q, 0),
    skus: Object.keys(state.items).sort(),
    updatedAt: state.updatedAt,
  };
}
```

```typescript file=workflows.ts
import {
  allHandlersFinished, condition, continueAsNew, defineSignal, defineUpdate, log,
  proxyActivities, setHandler, workflowInfo,
} from '@temporalio/workflow';
import type { CartActivities } from './activities';
import { buildCartDocument } from './document';

const { indexCart } = proxyActivities<CartActivities>({
  startToCloseTimeout: '10s',
  retry: { maximumAttempts: 5 },        // then give up *this* flush, not the workflow
});

export interface CartState {
  cartId: string;
  items: Record<string, number>;
  updatedAt: string;
}

export const addItemUpdate = defineUpdate<CartState, [string, number]>('cart.addItem');
export const checkoutSignal = defineSignal('cart.checkout');

export async function cartWorkflow(input: CartState): Promise<CartState> {
  const state: CartState = { ...input, items: { ...input.items } };
  let dirty = true;          // project the initial state too
  let done = false;

  // Handlers mutate and mark. No I/O here.
  setHandler(addItemUpdate, (sku, qty) => {
    state.items[sku] = (state.items[sku] ?? 0) + qty;
    state.updatedAt = new Date().toISOString();
    dirty = true;
    return state;
  });
  setHandler(checkoutSignal, () => { done = true; });

  // One place flushes.
  async function flush(): Promise<void> {
    dirty = false;                                   // Rule 1: clear first
    try {
      await indexCart(buildCartDocument(state));     // Rule 2: current state
    } catch (err) {
      log.warn('projection flush failed; will retry on next change', { err: String(err) });
      dirty = true;                                  // Rule 3: entity is fine, try again later
    }
  }

  while (!done) {
    await condition(() => dirty || done || workflowInfo().continueAsNewSuggested);
    if (dirty) await flush();
    if (!done && workflowInfo().continueAsNewSuggested) {
      await condition(allHandlersFinished);
      if (dirty) await flush();                      // Rule 4: flush before rollover
      return continueAsNew<typeof cartWorkflow>(state);
    }
  }

  await condition(allHandlersFinished);
  if (dirty) await flush();                          // Rule 4: flush before exit
  return state;
}
```

Five rapid `addItem` updates: five immediate responses, one `indexCart` call carrying
the state after all five (or two calls, if the first was already in flight when the later
ones arrived — and the second carries the final state).

## Provenance

The dirty-flag-and-flush shape is a classic from UI rendering and game loops ("mark
dirty, redraw once per frame"). Applying it to Temporal projections is first-party: a
storefront's cart index was receiving one write per keystroke in the quantity field, and
— the part that actually hurt — occasionally showing a *lower* quantity than the cart had,
because two handler-initiated writes had landed out of order. Moving the write into the
main loop fixed both at once. The [State Machine Driver](../state-machine-driver/) later
absorbed the idea: its `onContextUpdate` hook marks dirty, and its loop flushes.

## Gotchas

1. **Read-your-writes is not a thing here.** The update response returns before the
   projection is written. Render from the update's return value, and treat the index as
   eventually consistent for lists and search — see
   [Workflow-Mediated Projections](../workflow-mediated-projections/).

2. **Don't put the write back in the handler "just for this one".** The reordering bug
   returns the moment two handlers can both write.

3. **A flush that always fails pins `dirty` true and spins the loop.** The example's
   `catch` sets `dirty` again and the loop immediately retries. Add a backoff (`await
   sleep('5s')` in the catch) or a failure counter if the projection store can be down for
   long — the workflow should idle, not hammer.

4. **Projection staleness across `continueAsNew`.** Rule 4 handles the normal case; a
   worker crash between the flush and the `continueAsNew` command re-runs the flush on
   replay — which is fine, because indexing by document ID is idempotent.

5. **Queries don't set `dirty`.** Only mutations do. If a query handler appears to need
   to mark dirty, something upstream is mutating in a query — which is its own bug.

## References

- [Workflow-Mediated Projections](../workflow-mediated-projections/) — why the workflow is the only writer
- [Document Builder](../document-builder/) — what `buildCartDocument` should look like
- [State Machine Driver](../state-machine-driver/) — where the flag and the flush live in framework code
- [`allHandlersFinished`](../all-handlers-finished/) and [`continueAsNew`](../continue-as-new/) — the exits that must flush first
