# Replay Testing

> Prove that a workflow change is compatible with every execution already in flight by
> replaying recorded histories against the new build — in CI, before deploy.

[Enforcement Mechanisms §3](enforcement-mechanisms.md#3-replay-tests) says *why* replay
tests belong in the enforcement hierarchy: they check the one property — determinism
across a change — that no lint rule or runtime guard can see. This page is the *how*: what
to record, how to run it, how to read a failure, and how to keep the corpus honest.

---

## What replay proves (and what it doesn't)

A replay test feeds a recorded event history to the current workflow code and checks that
the code produces the same sequence of commands the history contains. It answers exactly
one question: **"Can this build safely pick up an execution that was started by an older
build?"**

| Question | Tool |
|---|---|
| Does the new code still follow the recorded pasts? | **Replay** — `Worker.runReplayHistories` against committed histories |
| Does the new code do the right thing on new executions? | **Time-skipping test environment** — `TestWorkflowEnvironment.createTimeSkipping()` with real workers and mocked activities |
| Does the pure decision logic behave? | **Unit tests** of `decide` / the decider — no Temporal at all |

All three run in CI; they are not substitutes for each other. A replay suite with no
behavioural tests will happily certify a workflow that is deterministic and wrong.

---

## The corpus

Histories are JSON files exported from a real environment (staging is ideal — real code
paths, no customer data) and **committed** alongside the tests.

```bash
# One file per code path. Name by what the history covers, not by workflow ID.
temporal workflow show --workflow-id store-001.cart.c-42 --output json \
  > test/histories/cart-happy-path.json
```

What belongs in it — one history per *distinct path through the code*:

- every state in a state registry, reached at least once;
- every `patched()` branch, old and new side;
- at least one `continueAsNew` chain (the last run before and the first run after);
- one failure-and-recovery, one timeout, one cancellation;
- anything a past incident was about.

What does not: fifty histories of the same happy path. Replay cost is roughly linear in
events; keep each history as short as a real execution of that path allows (terminate
long-lived entities in the export environment once the path is covered).

---

## The test

```typescript file=replay.test.ts
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { Worker } from '@temporalio/worker';
import { DeterminismViolationError } from '@temporalio/workflow';
import { COVERAGE } from './histories/manifest';
import { cartStates } from '../src/cart/states';

const HISTORIES = path.join(__dirname, 'histories');

async function loadHistories(): Promise<Array<{ workflowId: string; history: unknown }>> {
  const files = (await readdir(HISTORIES)).filter((f) => f.endsWith('.json')).sort();
  return Promise.all(files.map(async (f) => ({
    workflowId: f.replace(/\.json$/, ''),
    history: JSON.parse(await readFile(path.join(HISTORIES, f), 'utf8')) as unknown,
  })));
}

describe('replay', () => {
  it('every recorded history replays on the current build', async () => {
    const histories = await loadHistories();
    expect(histories.length).toBeGreaterThan(0);             // an empty corpus is a silent pass

    const failures: string[] = [];
    for await (const r of Worker.runReplayHistories(
      {
        workflowsPath: require.resolve('../src/cart/workflows'),
        // Use the SAME bundling options, interceptors and sinks as the production worker —
        // a replay worker that differs from production replays a different program.
        replayName: 'ci',
      },
      histories,
    )) {
      if (r.error) {
        const kind = r.error instanceof DeterminismViolationError ? 'NON-DETERMINISM' : r.error.name;
        failures.push(`${r.workflowId}: ${kind} — ${r.error.message}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('the corpus covers every state in the registry', async () => {
    const files = (await readdir(HISTORIES)).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
    const covered = new Set(files.flatMap((f) => COVERAGE[f] ?? []));
    const missing = Object.keys(cartStates).filter((state) => !covered.has(state));
    expect(missing).toEqual([]);                              // a new state with no history fails here
  });
});
```

```typescript file=histories/manifest.ts
/** Which states each committed history visits. Maintained by hand; checked by the test above. */
export const COVERAGE: Record<string, string[]> = {
  'cart-happy-path':    ['pending', 'processing', 'shipped'],
  'cart-expired':       ['pending'],
  'cart-rollover':      ['pending', 'processing'],   // continueAsNew mid-processing
  'cart-recovery':      ['processing'],              // finalize failed, redeemed
};
```

The coverage test is what turns "we have replay tests" into "replay tests mean
something". Without it, the first new state ships untested and nobody notices until an
in-flight execution reaches it on the new build.

---

## Reading a failure

A `DeterminismViolationError` names the command the *code* produced at some position and
the event the *history* recorded there. Read it as a diff:

- **Code scheduled an activity the history doesn't have** (or in a different order) →
  a command was added or moved. Either revert the order, or gate the change behind
  `patched()` so old histories take the old branch —
  [Versioning Strategy](../patterns/versioning-strategy/).
- **History has an event the code no longer produces** → a command was removed. Same fix:
  `patched()` keeps the old branch for old executions; `deprecatePatch` once no execution
  needs it.
- **Activity/child/signal *type* mismatch at the same position** → a rename. Renames are
  removals plus additions; treat as above.
- **Replay fails only for a history recorded before a `continueAsNew` shape change** →
  the *arguments* changed; the migrate-on-entry step in
  [`continueAsNew`](../patterns/continue-as-new/) is missing a case.

A failure that is *not* a `DeterminismViolationError` — a thrown `TypeError`, an
unresolved import — is a plain bug that the recorded inputs happened to exercise; fix it
as such.

---

## CI wiring

- Run the replay suite on every pull request, next to lint and unit tests. It needs no
  Temporal server — the replay worker is in-process.
- Keep `test/histories/` in the repository. It is test data; review changes to it like
  code.
- **Refresh on a schedule, not on a whim.** A weekly job that re-exports the manifest's
  workflow IDs from staging and opens a pull request if anything changed keeps the corpus
  from fossilizing. Export *after* a release has run the new paths, so the corpus always
  contains histories produced by the current build as well as older ones.
- When a workflow type is retired, delete its histories in the same change; a replay test
  for a workflow that no longer exists is noise.

---

## Gotchas

1. **Same bundle, same interceptors.** `ReplayWorkerOptions` accepts the worker's bundling
   options and interceptors; pass exactly what production passes. A replay worker that
   omits a production interceptor that schedules commands will report false
   non-determinism — or worse, miss real non-determinism.

2. **Exports contain payloads.** Histories carry every argument and result. Export from an
   environment whose data you are willing to commit, or run the export through a scrubbing
   step; never commit production histories with customer data.

3. **Long-lived entities need a terminated history.** `temporal workflow show` on a running
   workflow exports the history so far, which replays fine; but a corpus that only ever
   covers "the first 300 events of a cart" never covers the terminal states. Drive test
   entities to completion in staging before exporting.

4. **`continueAsNew` chains are several histories.** Each run is its own workflow
   execution with its own history. Export the last run of the old shape and the first run
   of the new one; both must replay.

5. **Replay is not a load test.** Thousands of histories replay slowly in CI. Curate by
   path coverage (the manifest), not by volume.

## References

- [Enforcement Mechanisms §3 — Replay Tests](enforcement-mechanisms.md#3-replay-tests) — where this fits in the hierarchy
- [Temporal TypeScript SDK — Testing suite: replay](https://docs.temporal.io/develop/typescript/best-practices/testing-suite#replay)
- [Temporal TypeScript SDK — Versioning: testing a workflow for replay safety](https://docs.temporal.io/develop/typescript/workflows/versioning#testing-a-workflow-for-replay-safety)
- [`Worker.runReplayHistories` API reference](https://typescript.temporal.io/api/classes/worker.Worker#runreplayhistories)
- [`temporal workflow show`](https://docs.temporal.io/cli/command-reference/workflow#show)
- [Worker Restart and Replay](../gotchas/worker-restart-replay.md) — what replay re-executes and what it reads from history
- [Versioning Strategy](../patterns/versioning-strategy/) — what to do when the replay test fails on purpose
- [State Machine Driver](../patterns/state-machine-driver/) — the registry the coverage check reads
