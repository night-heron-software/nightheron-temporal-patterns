# Night Heron Temporal Patterns

A catalog of patterns for building TypeScript applications on
[Temporal](https://temporal.io) durable execution. Each pattern is a self-contained
reference with a problem statement, solution, annotated code examples, provenance, and
gotchas.

These patterns emerged from building production-style applications — a multi-tenant
e-commerce platform, a starter template, and a full-stack demo — on the Temporal
TypeScript SDK. They are not theoretical best practices; they are solutions to real
problems encountered during development.

> _This documentation was drafted with AI assistance._

---

## Pattern Catalog

### Sandbox & Bundling

| Pattern | Summary |
|---|---|
| [Two-File Activity](patterns/two-file-activity/) | Structural separation of activity contracts from implementations to prevent sandbox contamination |
| [Definitions File](patterns/definitions-file/) | Centralizing `defineQuery`/`defineSignal`/`defineUpdate` for safe cross-runtime imports |
| [Record-First DTOs](patterns/record-first-dtos/) | Using `Record<string, T>` instead of `Map`/`Set` across serialization boundaries |

### State Machines

| Pattern | Summary |
|---|---|
| [Prepare → Decide → Finalize](patterns/prepare-decide-finalize/) | Three-phase state handler separating I/O from pure decision logic |
| [Chassaing Decider](patterns/chassaing-decider/) | `decide(command, state) → events` + `evolve(state, event) → state` for testable business logic |

### Communication

| Pattern | Summary |
|---|---|
| [Signals, Updates & Queries](patterns/signals-updates-queries/) | Choosing the right Temporal communication primitive |
| [`updateWithStart`](patterns/update-with-start/) | Atomic lazy entity creation with zero race conditions |
| [`allHandlersFinished`](patterns/all-handlers-finished/) | Preventing lost update responses at workflow exit points |

### Lifecycle

| Pattern | Summary |
|---|---|
| [`continueAsNew`](patterns/continue-as-new/) | Resetting event history for long-running workflows without losing state |
| [Structured Workflow IDs](patterns/structured-workflow-ids/) | Parseable, predictable `{tenantId}.{domain}.{entityId}` identifiers |
| [Parent-Child with ABANDON](patterns/parent-child-abandon/) | Decoupling child workflow lifecycles from parents |
| [Workflow-per-Entity vs. Singleton](patterns/workflow-per-entity-vs-singleton/) | Choosing the right cardinality model |
| [Standalone Activities](patterns/standalone-activities/) | When a thin single-activity wrapper should skip the workflow shell |

### CQRS & Projections

| Pattern | Summary |
|---|---|
| [Dirty-Flag Projection](patterns/dirty-flag-projection/) | Write coalescing to prevent projection write amplification |
| [Workflow-Mediated Projections](patterns/workflow-mediated-projections/) | Ensuring projection consistency by routing all writes through workflows |
| [Document Builder](patterns/document-builder/) | Explicit field mapping from workflow state to search documents |

### Resilience

| Pattern | Summary |
|---|---|
| [Redemptive State Recovery](patterns/redemptive-state-recovery/) | Returning to last known good state instead of crashing |
| [Feature Flags via Activities](patterns/feature-flags-via-activities/) | Runtime-switchable behavior without worker restarts |

---

## Gotchas

TypeScript-specific pitfalls that don't fit neatly into a pattern:

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

---

## License

[MIT](LICENSE)
