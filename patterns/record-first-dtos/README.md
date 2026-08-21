# Record-First DTOs

> Use `Record<string, T>` instead of `Map` or `Set` for all data transfer objects
> crossing serialization boundaries — Temporal uses JSON serialization, which strips
> class identity from Map and Set.

## Problem

Every value that crosses a Temporal boundary — workflow arguments, activity arguments and
results, signal/update/query payloads, `continueAsNew` arguments, child workflow inputs —
goes through the data converter, and the default converter is JSON. `JSON.stringify` has
opinions that TypeScript does not share:

| You send | It arrives as | TypeScript said |
|---|---|---|
| `new Map([['sku-1', 2]])` | `{}` | `Map<string, number>` |
| `new Set(['a', 'b'])` | `{}` | `Set<string>` |
| `new Date()` | `"2026-01-01T00:00:00.000Z"` (a string) | `Date` |
| `{ a: undefined }` | `{}` (key dropped) | `{ a?: T }` |
| `10n` | **throws** `TypeError` | `bigint` |
| `new LineItem(...)` | plain object, no prototype | `LineItem` |

The type checker is satisfied on both sides, so the failure is silent and shows up as an
empty cart in a query response, a `.has is not a function` in a handler, or a `getTime is
not a function` in an activity — far from the code that built the value.

## Solution

**DTOs are plain data.** For every type that crosses a boundary:

| Instead of | Use |
|---|---|
| `Map<K, V>` | `Record<string, V>` (keys are strings anyway after JSON) |
| `Set<T>` | `T[]`, deduplicated on write |
| `Date` | ISO-8601 `string` |
| `bigint` | `number`, or a decimal `string` if it does not fit |
| class instance | `interface` + discriminated union |
| optional `undefined` | explicit `null` if absence must be observable |

### Rules

1. **Workflow state is a DTO too.** It crosses the boundary on every `continueAsNew` and
   every query response. Use `Record` inside the workflow, not just at the edges.

2. **Convert at the boundary if you must use `Map` internally.** A pure function may use a
   `Map` for convenience, but it converts with `Object.fromEntries` / `Object.entries`
   before the value leaves. Prefer not to: two representations of the same data is a
   source of drift.

3. **Make the rule a type.** A compile-time `Serializable<T>` check on every DTO turns the
   silent failure into a red squiggle.

### The `Serializable<T>` check

```typescript file=serializable.ts
type Forbidden = Map<unknown, unknown> | Set<unknown> | Date | bigint | ((...args: never[]) => unknown);

/** Resolves to `true` if T is plain JSON-shaped data, `false` otherwise. */
export type Serializable<T> =
  T extends Forbidden ? false
  : T extends (infer U)[] ? Serializable<U>
  : T extends object ? ({ [K in keyof T]-?: Serializable<T[K]> }[keyof T] extends true ? true : false)
  : true;

/** Compile-time assertion: `assertSerializable<CartState>()` fails to type-check if it isn't. */
export function assertSerializable<T>(..._: Serializable<T> extends true ? [] : [never]): void {}
```

```typescript file=types.ts
import { assertSerializable } from './serializable';

export interface CartState {
  cartId: string;
  items: Record<string, number>;    // sku → quantity
  couponCodes: string[];            // a set, stored as a deduplicated array
  createdAt: string;                // ISO timestamp
  note: string | null;              // explicit null, not undefined
}
assertSerializable<CartState>();    // ✅ compiles

interface BadCartState {
  items: Map<string, number>;
  createdAt: Date;
}
// @ts-expect-error — Map and Date do not survive JSON
assertSerializable<BadCartState>();
```

The `@ts-expect-error` line is itself a test: if the guard ever stops catching `Map`, the
directive becomes an "unused" error and the build fails.

## Example

A cart workflow whose state is Record-first throughout, and so survives `continueAsNew`
and arrives intact in a query:

```typescript file=workflows.ts
import { condition, continueAsNew, defineQuery, defineSignal, setHandler, workflowInfo } from '@temporalio/workflow';
import type { CartState } from './types';

export const addItemSignal = defineSignal<[string, number]>('cart.addItem');
export const applyCouponSignal = defineSignal<[string]>('cart.applyCoupon');
export const getCartQuery = defineQuery<CartState>('cart.get');

export async function cartWorkflow(input: CartState): Promise<CartState> {
  const cart: CartState = { ...input, items: { ...input.items }, couponCodes: [...input.couponCodes] };

  setHandler(addItemSignal, (sku, qty) => {
    cart.items[sku] = (cart.items[sku] ?? 0) + qty;           // Record: plain property access
  });
  setHandler(applyCouponSignal, (code) => {
    if (!cart.couponCodes.includes(code)) cart.couponCodes.push(code);   // "Set": dedupe on write
  });
  setHandler(getCartQuery, () => cart);                        // arrives as-is in the client

  await condition(() => workflowInfo().continueAsNewSuggested, '30 days');
  return continueAsNew<typeof cartWorkflow>(cart);             // round-trips as-is
}
```

What the same code looks like with a `Map` — and what the client actually receives:

```typescript fragment
const items = new Map<string, number>();
setHandler(getCartQuery, () => ({ items }));
// client: await handle.query(getCartQuery)  →  { items: {} }   — every time, with no error
```

## Provenance

The behavior is JavaScript's (`JSON.stringify`) and the SDK's default
[data converter](https://docs.temporal.io/dataconversion). The rule is first-party,
written after a cart's `Map<string, LineItem>` arrived at the storefront as `{}` — the
workflow's query handler returned the live `Map`, the SDK serialized it, and the UI
rendered an empty cart while the workflow's own state was fine. The `Serializable<T>`
assertion followed, so that the next such type would not compile.

## Gotchas

1. **`Date` does not throw — it quietly becomes a string.** `toJSON()` runs, the string
   arrives, and the first `.getTime()` on the receiving side is the error. Store ISO strings
   and parse where you need arithmetic.

2. **`undefined` fields disappear; `null` fields survive.** `Record<string, T | undefined>`
   loses keys whose value is `undefined`. If "present but empty" matters, use `null`.

3. **Integer-like keys iterate in ascending numeric order.** `Object.keys({ '10': 1, '2': 1 })`
   is `['2', '10']` regardless of insertion order. Deterministic — the same on every replay
   — but surprising if you expected insertion order for SKU-like keys. Sort explicitly when
   order is part of the meaning.

4. **`bigint` throws at serialization time.** Unlike `Map`, this one is loud:
   `TypeError: Do not know how to serialize a BigInt`. Use `number` or a decimal string.

5. **Class instances lose their methods, not their data.** `instanceof` is `false` on the
   other side and methods are gone. Model polymorphism with a `type` discriminator and
   functions that switch on it.

6. **Payloads have a size limit** (2 MB per payload by default, server-configurable). A
   Record-first DTO is not automatically small; keep state lean and project large documents
   via activities — see [Document Builder](../document-builder/).

7. **A custom data converter can handle `Map` — but then every consumer needs it.** The
   web app, the CLI, the UI, replay tests. Plain data is the representation every consumer
   already understands.

## References

- [Temporal — Data conversion](https://docs.temporal.io/dataconversion)
- [Temporal TypeScript SDK — Data converters](https://docs.temporal.io/develop/typescript/converters-and-encryption)
- [Definitions File](../definitions-file/) — where DTO types are declared
- [`continueAsNew`](../continue-as-new/) — the boundary workflow state crosses on every rollover
- [Document Builder](../document-builder/) — mapping state to a search document explicitly
