# Two-File Activity Pattern

> Structurally separate activity contracts from implementations so the workflow sandbox
> can never reach I/O code.

## Problem

Temporal workflow code runs in a deterministic sandbox. The SDK bundles the entire
module graph reachable from a workflow file into a V8 isolate. If a workflow file
imports an activity that imports a database driver, the sandbox tries to bundle the
driver — and either fails at build time or loads and misbehaves silently under replay.

The SDK's first-party solution is `import type * as activities` — a type-only import
that the TypeScript compiler erases before bundling. This keeps I/O code out of the
workflow bundle, but the safety boundary is a single keyword (`type`). Remove it and
the build breaks; worse, some third-party modules that appear type-safe actually
perform side effects at import time, and ESLint cannot detect this.

A second problem emerges in full-stack applications: the Next.js bundler (or any web
framework bundler) is a *third* consumer of activity-related code. The web app needs
type signatures and query/signal/update definitions to interact with workflows via the
Temporal client, but it must never bundle database drivers or Temporal worker internals.
A single `activities.ts` file cannot serve all three consumers safely.

## Solution

Split every domain's activities into two files:

| File | Imported by | Contains |
|---|---|---|
| `activities.ts` | Workflows, web app server code | `proxyActivities()` calls, interfaces, retry/timeout config — **no I/O** |
| `activities-impl.ts` | Worker entrypoint only | Real implementations with database clients, HTTP, anything |

```
┌─────────────────┐    import type     ┌──────────────────┐
│  workflows.ts   │ ─────────────────> │  activities.ts   │
│  (sandbox)      │                    │  (contract)      │
└─────────────────┘                    └──────────────────┘
                                              │
┌─────────────────┐    import          ┌──────────────────┐
│  worker.ts      │ ─────────────────> │ activities-impl  │
│  (Node.js)      │                    │ (implementation) │
└─────────────────┘                    └──────────────────┘
                                              │
                                       ┌──────────────────┐
                                       │  DB drivers,     │
                                       │  HTTP clients,   │
                                       │  external APIs   │
                                       └──────────────────┘
```

### Rules

1. **`activities.ts` imports only types.** It contains `proxyActivities<T>()` with
   retry/timeout configuration, an interface declaring the activity signatures, and
   nothing else. No `import` of any module that performs I/O at import time.

2. **`activities-impl.ts` is never imported by workflow code or web app code.** Only the
   worker entrypoint (where `Worker` is constructed) imports it to register the
   implementations.

3. **Names and signatures must match across both files.** TypeScript enforces this — the
   `proxyActivities<T>()` generic parameter is typed against the interface or `typeof`
   the implementation module.

4. **Retry and timeout policies live in `activities.ts`.** Policy is a property of the
   activity contract, not of each call site. Centralizing it prevents inconsistent
   timeout configurations scattered across workflows.

## Example

**`activities.ts`** — the contract (sandbox-safe):

```typescript
import { proxyActivities } from '@temporalio/workflow';

export interface OrderActivities {
  validateInventory(sku: string, quantity: number): Promise<boolean>;
  processPayment(orderId: string, amount: number): Promise<string>;
  indexOrder(doc: OrderDocument): Promise<void>;
}

export const {
  validateInventory,
  processPayment,
  indexOrder,
} = proxyActivities<OrderActivities>({
  startToCloseTimeout: '30s',
  retry: {
    maximumAttempts: 3,
    initialInterval: '1s',
    backoffCoefficient: 2,
  },
});
```

**`activities-impl.ts`** — the implementation (worker-only):

```typescript
import { Client } from 'cassandra-driver';
import { Client as ESClient } from '@elastic/elasticsearch';
import type { OrderActivities } from './activities';

const db = new Client({ contactPoints: ['localhost'] });
const es = new ESClient({ node: 'http://localhost:9200' });

export async function validateInventory(
  sku: string,
  quantity: number,
): Promise<boolean> {
  const result = await db.execute(
    'SELECT available FROM inventory WHERE sku = ?',
    [sku],
  );
  const available = result.rows[0]?.available ?? 0;
  if (available < quantity) {
    throw new Error(`Insufficient inventory for ${sku}: need ${quantity}, have ${available}`);
  }
  return true;
}

export async function processPayment(
  orderId: string,
  amount: number,
): Promise<string> {
  // Call external payment API
  const response = await fetch('https://api.payments.example/charge', {
    method: 'POST',
    body: JSON.stringify({ orderId, amount }),
  });
  if (!response.ok) {
    throw new Error(`Payment failed: ${response.statusText}`);
  }
  const { transactionId } = await response.json();
  return transactionId;
}

export async function indexOrder(doc: OrderDocument): Promise<void> {
  await es.index({ index: 'orders', id: doc.orderId, body: doc });
}
```

**`workflows.ts`** — the workflow imports only the contract:

```typescript
import { validateInventory, processPayment, indexOrder } from './activities';

export async function orderWorkflow(input: OrderInput): Promise<OrderResult> {
  await validateInventory(input.sku, input.quantity);
  const txnId = await processPayment(input.orderId, input.amount);
  await indexOrder(buildOrderDocument(input, txnId));
  return { orderId: input.orderId, transactionId: txnId };
}
```

**`worker.ts`** — the worker imports only the implementation:

```typescript
import { Worker } from '@temporalio/worker';
import * as activities from './activities-impl';

const worker = await Worker.create({
  workflowsPath: require.resolve('./workflows'),
  activities,
  taskQueue: 'order-queue',
});

await worker.run();
```

## Provenance

The Temporal TypeScript SDK established the core mechanism: `proxyActivities<T>()` with
`import type` to keep I/O out of the workflow bundle. Every official sample in
[`temporalio/samples-typescript`](https://github.com/temporalio/samples-typescript)
uses this approach with a single `activities.ts` file.

The two-file split extends the SDK's intent by making the boundary **structural** rather
than relying on a single keyword to enforce it. The motivation is twofold:

1. **What lint cannot see.** ESLint can ban `node:*` imports, but it cannot know which
   third-party modules perform I/O at import time. File-level separation makes the
   boundary visible and enforceable without understanding every transitive dependency.

2. **The third consumer.** In a full-stack application (e.g., Next.js + Temporal),
   the web framework's bundler is a third module consumer alongside the workflow sandbox
   and the worker. A single file that serves all three safely would need careful
   type-gating; two files make the boundaries unambiguous.

## Gotchas

1. **Activities must throw on infrastructure errors, never return fallbacks.** An activity
   that returns `false` or `null` when the database is down converts an infrastructure
   outage into a business outcome ("out of stock") and defeats Temporal's retry machinery.
   Let it throw; configure the retry policy at the proxy in `activities.ts`.

2. **Type drift between the two files.** If you add a parameter to the interface in
   `activities.ts` but forget to update `activities-impl.ts`, TypeScript catches it — but
   only if the worker entrypoint types are checked. Ensure both files are covered by
   `tsc --noEmit`.

3. **Don't put `proxyActivities` in `activities-impl.ts`.** The proxy is a workflow-side
   construct. Putting it in the implementation file defeats the entire pattern.

## References

- [Temporal TypeScript SDK — Activity Development](https://docs.temporal.io/develop/typescript/core-application#develop-activities)
- [Temporal TypeScript SDK — Workflow Sandbox](https://docs.temporal.io/develop/typescript/core-application#workflow-sandbox)
- [Definitions File](../definitions-file/) — the companion pattern for query/signal/update handles
