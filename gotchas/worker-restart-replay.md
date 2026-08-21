# Worker Restart and Replay

> When a worker crashes and restarts, Temporal replays the workflow from its event
> history — a code change that alters the sequence of commands breaks every execution
> that is mid-flight.

## The Trap

Workflow code must produce the **same sequence of commands** during replay as it did
during the original execution. Violations cause `Non-Determinism` errors:

```typescript fragment
// ✅ Safe change: adding a log line between existing activity calls
await activityA();
log.info('checkpoint reached'); // New line — safe, no command generated
await activityB();

// ❌ Unsafe change: reordering activity calls
await activityB(); // Was activityA — replay expects A's result here
await activityA();

// ❌ Unsafe change: adding a new activity call between existing ones
await activityA();
await newActivity(); // Replay has no history entry for this
await activityB();
```

## Why It Happens — What Replays

After a restart the worker re-runs the workflow function from the top, feeding it the
recorded history instead of talking to the server. What each construct does under replay:

| Construct | During Replay |
|---|---|
| Activity results | **Not re-executed** — results are read from the event history |
| `wf.sleep()` timers | **Instant** — already-fired timers resolve immediately from history |
| Signal / update handlers | **Re-delivered** from the event history, in the original order |
| `uuid4()`, `Math.random()` | **Deterministic** — the sandbox patches them to a seeded source, so they return the same values on replay |
| `Date.now()` / `new Date()` | **Deterministic** — the sandbox returns the workflow-task time recorded in history, not wall-clock time |
| `log.*` from `@temporalio/workflow` | **Suppressed** — the workflow logger is replay-aware and omits messages while replaying |
| `console.log()` | **Re-executed** — you will see duplicate log lines; prefer `log` |
| Local activities | **Not re-executed** — results are read from the marker events in history |

The TypeScript SDK has no `sideEffect()` API (that is a Go/Java construct). For a
non-deterministic value that must be recorded once, use a local activity or a regular
activity.

## Prevention — Safe Evolution

- **Adding a new activity at the end** of the workflow is safe for executions that have not
  yet reached that point.
- **Changing activity order** or inserting commands requires the
  [`patched()`](https://docs.temporal.io/develop/typescript/versioning#patched) API to branch
  old vs. new executions — or Worker Deployment Versioning, which pins each execution to the
  build that started it so old and new code never replay each other's histories.
- **Prove it in CI.** Replay recorded histories against the new build with
  `Worker.runReplayHistories()` before deploying — see
  [Enforcement Mechanisms — Replay Tests](../reference/enforcement-mechanisms.md#3-replay-tests).

## Workers Do Not Hot-Reload Workflow Code

The workflow bundle is built once at `Worker.create()`. Editing `workflows.ts` (or anything
it imports) has no effect on a running worker: restart the worker, and the new bundle takes
effect for subsequent workflow tasks. This applies equally to a single-domain worker and to
an all-in-one development launcher, and it is a property of the SDK, not of any pattern in
this catalog. Other pages link here rather than repeating it.

## See Also

- [Temporal — Workflow Determinism](https://docs.temporal.io/workflows#deterministic-constraints)
- [Temporal — Versioning with `patched()`](https://docs.temporal.io/develop/typescript/versioning#patched)
- [Temporal — Worker Deployment Versioning](https://docs.temporal.io/production-deployment/worker-deployments/worker-versioning)
- [State Machine Driver](../patterns/state-machine-driver/) and
  [Unified Worker Topology](../patterns/unified-worker-topology/) — patterns whose gotchas
  point here
- [No Dynamic Imports](no-dynamic-imports.md) — another way to break the bundle's guarantees
