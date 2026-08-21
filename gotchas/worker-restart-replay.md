# Worker Restart and Replay

> When a worker crashes and restarts, Temporal replays the workflow from the last
> checkpoint — understanding what replays and what doesn't is essential for safe
> workflow evolution.

## What Replays

| Construct | During Replay |
|---|---|
| Activity results | **Not re-executed** — results are read from the event history |
| `wf.sleep()` timers | **Instant** — already-expired timers skip immediately |
| Signal handlers | **Re-delivered** from the event history |
| `console.log()` calls | **Re-executed** — you'll see duplicate log lines |
| Side effects via `wf.sideEffect()` | **Not re-executed** — result read from history |

## The Non-Determinism Trap

Workflow code must produce the **same sequence of commands** during replay as it did
during the original execution. Violations cause `Non-Determinism` errors:

```typescript
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

## Safe Evolution

- **Adding a new activity at the end** of the workflow is safe for new executions.
- **Changing activity order** requires the [`patched()`](https://docs.temporal.io/develop/typescript/versioning#patched) API to branch old vs. new executions.
- **Workers do not hot-reload workflow code.** After editing workflow files, restart
  the worker. The new code takes effect for new workflow tasks.

## References

- [Temporal — Workflow Determinism](https://docs.temporal.io/workflows#deterministic-constraints)
- [Temporal — Versioning with `patched()`](https://docs.temporal.io/develop/typescript/versioning#patched)
