# Feature Flags via Activities

> Check feature flags through activities at decision points, not through environment
> variables — enabling runtime-switchable behavior without worker restarts, with
> the flag check recorded in Temporal history for debugging.

## Problem

A feature flag in workflow code is tempting to read the way you would anywhere else:
`if (process.env.FRAUD_CHECK_V2 === 'true')`. Inside a Temporal workflow that is wrong
three times over:

1. **It is not available.** The workflow sandbox does not expose the worker's
   environment. A bundler can inline a value at build time, which only moves the problem:
   the value is now frozen into the bundle.

2. **It is non-deterministic.** Worker A has the flag on, worker B has it off. A workflow
   that branched on the flag on A, later replayed on B, takes the other branch and fails
   with a non-determinism error. Any value that can differ between workers, or between
   now and replay, must come through history.

3. **It is invisible.** When someone asks why order 42 skipped the fraud check, nothing in
   the workflow's history says "because the flag was off at 10:03".

## Solution

Evaluate the flag in an **activity** — a local activity, usually — at the decision point,
and hand the result to the decision as **data**:

- The activity result is recorded in history, so replay sees the same value the original
  execution did: deterministic by construction.
- The value is fetched at runtime from whatever the flag provider is, so flipping the flag
  takes effect on the next decision with no worker restart.
- The history shows the evaluation — flag name, value, source, time — next to the decision
  it informed.

```mermaid
sequenceDiagram
    participant W as orderWorkflow
    participant A as evaluateFlag (local activity)
    participant P as Flag provider
    W->>A: evaluateFlag('fraud-check-v2', {tenantId})
    A->>P: GET /flags/fraud-check-v2?tenant=…
    P-->>A: enabled: true
    A-->>W: { enabled: true, source: 'provider', evaluatedAt }   (recorded in history)
    W->>W: decide(input, flag)   — pure; the flag is an argument
```

### Rules

1. **Workflow code never reads configuration for behaviour.** Not `process.env`, not a
   config module, not a constant that differs per deployment. Behaviour-affecting values
   arrive as workflow arguments or activity results.

2. **Evaluate once, at the decision point, and pass the value in.** The decision function
   takes `flag.enabled` as a parameter — [Prepare → Decide → Finalize](../prepare-decide-finalize/):
   the evaluation is `prepare`, the branch is `decide`.

3. **Local activity, short timeout, bounded retry.** Flag reads are cheap and have no side
   effects; a local activity records the result without a full activity round trip.

4. **The result says where it came from.** `{ enabled, source: 'provider' | 'default' }`.
   If the provider is down and the code falls back, the fallback is explicit, logged, and
   visible in the record — never a silent `?? false`.

5. **Flags affect future decisions only.** An in-flight workflow that already recorded
   `enabled: false` keeps that value on replay. That is the feature, not a bug; a flag is
   not a way to change the past.

## Example

```typescript file=activities.ts
export interface FlagEvaluation {
  flag: string;
  enabled: boolean;
  source: 'provider' | 'default';
  evaluatedAt: string;
}
export interface FlagActivities {
  evaluateFlag(flag: string, context: { tenantId: string }): Promise<FlagEvaluation>;
}
export interface OrderActivities {
  runFraudCheck(orderId: string): Promise<{ score: number }>;
  placeOrder(orderId: string): Promise<{ orderId: string; placedAt: string }>;
}
```

```typescript file=activities-impl.ts
import type { FlagActivities, FlagEvaluation } from './activities';

const cache = new Map<string, { enabled: boolean; expiresAt: number }>();   // worker-side, 30s TTL

async function fetchFlag(flag: string, tenantId: string): Promise<boolean> {
  const res = await fetch(`https://flags.internal.example/v1/${flag}?tenant=${encodeURIComponent(tenantId)}`);
  if (!res.ok) throw new Error(`flag provider returned ${res.status} for ${flag}`);   // let the retry policy work
  const body = (await res.json()) as { enabled: boolean };
  return body.enabled;
}

export const flagActivities = {
  async evaluateFlag(flag, { tenantId }): Promise<FlagEvaluation> {
    const key = `${tenantId}:${flag}`;
    const hit = cache.get(key);
    const enabled = hit && hit.expiresAt > Date.now() ? hit.enabled : await fetchFlag(flag, tenantId);
    cache.set(key, { enabled, expiresAt: Date.now() + 30_000 });
    return { flag, enabled, source: 'provider', evaluatedAt: new Date().toISOString() };
  },
} satisfies FlagActivities;
```

```typescript file=workflows.ts
import { log, proxyActivities, proxyLocalActivities } from '@temporalio/workflow';
import type { FlagActivities, FlagEvaluation, OrderActivities } from './activities';

const { evaluateFlag } = proxyLocalActivities<FlagActivities>({
  startToCloseTimeout: '2s',
  retry: { maximumAttempts: 3 },                 // Rule 3
});
const { runFraudCheck, placeOrder } = proxyActivities<OrderActivities>({ startToCloseTimeout: '30s' });

export interface OrderInput { tenantId: string; orderId: string; amountCents: number }

// Rule 2: pure — the flag is an argument, so this is a unit test, not an integration test.
export function decideFraudPath(input: OrderInput, fraudCheckV2: boolean): { runCheck: boolean } {
  if (!fraudCheckV2) return { runCheck: input.amountCents >= 50_000 };
  return { runCheck: input.amountCents >= 10_000 };
}

export async function orderWorkflow(input: OrderInput): Promise<{ orderId: string }> {
  let flag: FlagEvaluation;
  try {
    flag = await evaluateFlag('fraud-check-v2', { tenantId: input.tenantId });
  } catch (err) {
    // Rule 4: an explicit, recorded default — never a silent one.
    log.warn('flag provider unavailable; using default', { flag: 'fraud-check-v2', error: String(err) });
    flag = { flag: 'fraud-check-v2', enabled: false, source: 'default', evaluatedAt: new Date().toISOString() };
  }

  const { runCheck } = decideFraudPath(input, flag.enabled);
  if (runCheck) await runFraudCheck(input.orderId);
  const placed = await placeOrder(input.orderId);
  return { orderId: placed.orderId };
}
```

```typescript file=decide.test.ts
import { decideFraudPath } from './workflows';

it('lowers the fraud-check threshold when v2 is on', () => {
  const input = { tenantId: 't1', orderId: 'o1', amountCents: 20_000 };
  expect(decideFraudPath(input, false)).toEqual({ runCheck: false });
  expect(decideFraudPath(input, true)).toEqual({ runCheck: true });
});
```

## Provenance

That activity results are the only replay-safe source of external values is SDK doctrine.
Applying it to feature flags specifically is first-party, prompted by a fraud-check
rollout that was gated on a worker environment variable: half the fleet had it, workflows
migrated between workers under normal load, and the first non-determinism errors arrived
within the hour. The `source` field and the explicit default came from the follow-up
incident review: "the flag service was down and we can't tell which orders got the
default".

## Gotchas

1. **Removing the flag read is a versioning change.** A workflow that recorded the
   `evaluateFlag` local activity expects it on replay. Deleting the call (once the feature
   is permanent) changes the command sequence — gate the removal with `patched()` or a new
   worker deployment version, then clean up when no old executions remain.

2. **Local activities are not free.** They run in the workflow task and are recorded as
   markers. Keep the evaluation to one call per decision, not one per loop iteration; cache
   in the activity implementation, as the example does.

3. **Don't evaluate flags in query handlers.** Queries cannot run activities. If a read
   path needs a flag, evaluate it in the client.

4. **Per-tenant is the normal case.** Pass the tenant (and whatever else the provider
   segments on) in the activity arguments so the recorded evaluation says *whose* flag it
   was.

5. **Some "flags" are start-time configuration.** A value that must be stable for the
   whole life of an execution (the pricing rules in effect when the cart was created)
   belongs in the workflow's arguments, not in a per-decision lookup.

6. **`source: 'default'` is a signal, not a shrug.** Alert on it. A week of defaults means
   the provider has been down for a week and nobody noticed.

## References

- [Temporal — Deterministic constraints](https://docs.temporal.io/workflow-definition#deterministic-constraints)
- [Temporal TypeScript SDK — Activities](https://docs.temporal.io/develop/typescript/activities)
- [Prepare → Decide → Finalize](../prepare-decide-finalize/) — evaluation as `prepare`, branch as `decide`
- [Worker Restart and Replay](../../gotchas/worker-restart-replay.md) — why only recorded values are safe
- [Enforcement Mechanisms](../../reference/enforcement-mechanisms.md) — lint `process.env` out of workflow files
