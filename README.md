# Night Heron Temporal Patterns

A catalog of patterns for building TypeScript applications on
[Temporal](https://temporal.io) durable execution. Each pattern is a self-contained
reference with a problem statement, solution, annotated code examples, provenance, and
gotchas.

These patterns emerged from building production-style applications — a multi-tenant
e-commerce platform, a starter template, and a full-stack demo — on the Temporal
TypeScript SDK. They are not theoretical best practices; they are solutions to real
problems encountered during development.

*This documentation was drafted with AI assistance.*

> [!WARNING]
> **Early-stage.** All twenty patterns are written and every TypeScript example compiles
> against the Temporal TypeScript SDK (1.22) in CI — but the catalog has not been reviewed
> by the Temporal team or validated in production at scale. It reflects patterns developed
> during project work, not established best practices. Where an entry overlaps the official
> [Temporal Design Patterns](https://docs.temporal.io/design-patterns) catalog, the table
> says so; the official page is definitive for the general pattern. Expect renames and
> corrections as the catalog matures.

---

## Pattern Catalog

> ✅ = written; 🔲 = stub (title and one-sentence summary only). The **Official
> equivalent** column names the entry in Temporal's own
> [Design Patterns catalog](https://docs.temporal.io/design-patterns) that covers the same
> ground, where one exists — those pages are the definitive source for the general pattern,
> and the entry here is the TypeScript-specific discipline around it. "—" means no
> official counterpart.

### Sandbox & Bundling

| Pattern | Summary | Official equivalent |
|---|---|---|
| ✅ [Two-File Activity](patterns/two-file-activity/) | Structural separation of activity contracts from implementations to prevent sandbox contamination | — |
| ✅ [Definitions File](patterns/definitions-file/) | Centralizing `defineQuery`/`defineSignal`/`defineUpdate` for safe cross-runtime imports | — |
| ✅ [Record-First DTOs](patterns/record-first-dtos/) | Using `Record<string, T>` instead of `Map`/`Set` across serialization boundaries | — |

### State Machines

| Pattern | Summary | Official equivalent |
|---|---|---|
| ✅ [Prepare → Decide → Finalize](patterns/prepare-decide-finalize/) | Three-phase state handler separating I/O from pure decision logic | — |
| ✅ [Chassaing Decider](patterns/chassaing-decider/) | `decide(command, state) → events` + `evolve(state, event) → state` for testable business logic | — |
| ✅ [State Machine Driver](patterns/state-machine-driver/) | A reusable `runStateMachine` loop that wires updates, signals, and timeouts into a state function table | [Entity Workflow](https://docs.temporal.io/design-patterns/entity-workflow) (implements) |

### Communication

| Pattern | Summary | Official equivalent |
|---|---|---|
| ✅ [Signals, Updates & Queries](patterns/signals-updates-queries/) | Choosing the right Temporal communication primitive | [Workflow Messaging](https://docs.temporal.io/design-patterns/workflow-messaging-patterns) (Request-Response via Updates) |
| ✅ [`updateWithStart`](patterns/update-with-start/) | Atomic lazy entity creation with zero race conditions | [Workflow Messaging](https://docs.temporal.io/design-patterns/workflow-messaging-patterns) (Signal with Start / Request-Response via Updates) |
| ✅ [`allHandlersFinished`](patterns/all-handlers-finished/) | Preventing lost update responses at workflow exit points | — |

### Lifecycle

| Pattern | Summary | Official equivalent |
|---|---|---|
| ✅ [`continueAsNew`](patterns/continue-as-new/) | Resetting event history for long-running workflows without losing state | [Entity & Lifecycle](https://docs.temporal.io/design-patterns/entity-lifecycle-patterns) (Continue-As-New) |
| ✅ [Structured Workflow IDs](patterns/structured-workflow-ids/) | Parseable, predictable `{tenantId}.{domain}.{entityId}` identifiers | — |
| ✅ [Parent-Child with ABANDON](patterns/parent-child-abandon/) | Decoupling child workflow lifecycles from parents | [Task Orchestration](https://docs.temporal.io/design-patterns/task-orchestration-patterns) (Child Workflows) |
| ✅ [Workflow-per-Entity vs. Singleton](patterns/workflow-per-entity-vs-singleton/) | Choosing the right cardinality model | [Entity & Lifecycle](https://docs.temporal.io/design-patterns/entity-lifecycle-patterns) (Entity Workflow) |
| ✅ [Standalone Activities](patterns/standalone-activities/) | When a thin single-activity wrapper should skip the workflow shell | — |

### CQRS & Projections

| Pattern | Summary | Official equivalent |
|---|---|---|
| ✅ [Dirty-Flag Projection](patterns/dirty-flag-projection/) | Write coalescing to prevent projection write amplification | — |
| ✅ [Workflow-Mediated Projections](patterns/workflow-mediated-projections/) | Ensuring projection consistency by routing all writes through workflows | — |
| ✅ [Document Builder](patterns/document-builder/) | Explicit field mapping from workflow state to search documents | — |

### Resilience

| Pattern | Summary | Official equivalent |
|---|---|---|
| ✅ [Redemptive State Recovery](patterns/redemptive-state-recovery/) | Returning to last known good state instead of crashing | [Distributed Transaction](https://docs.temporal.io/design-patterns/distributed-transaction-patterns) (Saga — adjacent) |
| ✅ [Feature Flags via Activities](patterns/feature-flags-via-activities/) | Runtime-switchable behavior without worker restarts | — |

### Development & Operations

| Pattern | Summary | Official equivalent |
|---|---|---|
| ✅ [Unified Worker Topology](patterns/unified-worker-topology/) | A single all-in-one worker process for local dev that fans out to per-domain processes in production | [Worker Configuration](https://docs.temporal.io/design-patterns/worker-configuration-patterns) (Worker-Specific Task Queues — partial) |

---

## Gotchas

TypeScript-specific pitfalls that don't fit neatly into a pattern. Each one links back to
the patterns that cite it:

| Gotcha | Summary |
|---|---|
| [Async Predicate Death Loop](gotchas/async-predicate-death-loop.md) | `async` functions in `condition()` predicates create infinite loops |
| [Narrowing Across `condition()`](gotchas/narrowing-across-condition.md) | TypeScript type narrowing breaks when signal handlers reassign during yields |
| [No Dynamic Imports](gotchas/no-dynamic-imports.md) | `import()` in workflow code bypasses the deterministic sandbox |
| [Worker Restart Replay](gotchas/worker-restart-replay.md) | Understanding what replays and what doesn't after a worker crash |

---

## Reference

| Document | Summary |
|---|---|
| [Enforcement Mechanisms](reference/enforcement-mechanisms.md) | How to make patterns stick: lint rules, runtime guards, CI ratchets |

---

## Pattern Template

Every pattern follows this structure:

```markdown
# Pattern Name

> One-sentence summary.

## Problem

What failure, complexity, or ambiguity this pattern addresses.

## Solution

The pattern itself — structure, rules, and the "why".

## Example

Annotated TypeScript showing the pattern in use.

## Provenance

Where the pattern originated (SDK docs, academic prior art, first-party discovery).

## Gotchas

Sharp edges encountered when applying the pattern.

## References

Links to SDK docs, papers, and related patterns in this catalog.
```

## Gotcha Template

Gotchas are shorter and shaped around a single trap:

```markdown
# Gotcha Name

> One-sentence summary.

## The Trap

The code that looks right and isn't, with a ❌ / ✅ pair.

## Symptoms          (optional)

What you observe when you hit it.

## Why ...           (Why It's Hard to Catch / Why It Matters / Why This Is TypeScript-Specific)

The mechanism.

## Prevention        (or "The Fix")

The lint rule, type trick, or habit that stops it.

## See Also

Temporal maintains a first-party
[Design Patterns catalog](https://docs.temporal.io/design-patterns) covering general
usage patterns across all SDKs — Task Orchestration, Workflow Messaging, Entity &
Lifecycle, External Interaction, Distributed Transaction, Error Handling & Retry, Batch
Processing, QoS & Throughput, Performance & Latency, and Worker Configuration. It is the
**definitive source** for those patterns; the "Official equivalent" column above maps
each entry here to its counterpart, and an entry that has one is written as "what the
official page doesn't say for TypeScript" rather than a restatement.

The entries with no counterpart are where this catalog earns its keep: sandbox bundling
(Two-File Activity, Definitions File, Record-First DTOs), state-machine architecture
(Prepare → Decide → Finalize, Chassaing Decider, State Machine Driver, Redemptive State
Recovery), CQRS projections (Dirty-Flag, Workflow-Mediated, Document Builder), and the
operational conventions (Structured Workflow IDs, Unified Worker Topology, Feature Flags
via Activities, Standalone Activities) — plus
[Enforcement Mechanisms](reference/enforcement-mechanisms.md), which is about making any
of the above stick.

---

## License

[MIT](LICENSE)
