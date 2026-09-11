# Time-Skipping Capture Traps

> Three traps that make a replay-capture or end-to-end script against the time-skipping test environment stall, flake, or crash at startup — each looks like a different bug.

## The Trap

A script that drives workflows on `TestWorkflowEnvironment.createTimeSkipping()` and records their histories hits three separate problems:

1. **A second copy of `@temporalio/proto` crashes the process at startup.** Installing it with a range (`^1.19.0`) can resolve a newer version at the root beside the SDK's own nested copy, and two protobufjs registrations die with `duplicate name 'ActivityHeartbeat' in Namespace coresdk`.
2. **Time only skips while something awaits a workflow result.** Polling a query keeps time locked, so a simulated multi-day delay crawls in real time and the script appears to stall.
3. **`result()` on a handle whose workflow has not started yet rejects immediately** with not-found, which a settle-or-race helper reads as a failed workflow.

## Symptoms

- A crash at startup naming a duplicate protobuf type.
- A capture that stops making progress at a state that waits on a timer.
- A child workflow reported as failed when it never ran.

## Why It's Hard to Catch

Each trap mimics a different, more familiar failure: a broken install, a slow workflow, a real workflow error. None of them points at the time-skipping environment.

## Prevention

- Pin `@temporalio/proto` **exactly** to the SDK's version — `npm i -D -E` — matching `@temporalio/worker`'s minor.
- Sequence every capture the same way: confirm the child exists, await its `result()` (which unlocks skipping), then poll downstream state, then settle the rest. Bound every wait.
- Wait for the parent to actually start a child — poll its intake state — before settling the child's handle.

## See Also

- [Replay testing](../reference/replay-testing.md)
