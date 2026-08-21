# Async Predicate Death Loop

> Passing an `async` function to `wf.condition()` makes the predicate always truthy —
> the wait resolves immediately, and whatever loop surrounds it spins.

## The Trap

`wf.condition()` takes a **synchronous** predicate. If an `async` function is passed, it
returns a `Promise` — which is always truthy in JavaScript. The condition resolves
immediately, the surrounding loop re-evaluates it (still truthy), and repeats.

```typescript
// ❌ DEATH LOOP: Promise is always truthy
await wf.condition(async () => {
  return state.status === 'complete';
});

// ✅ CORRECT: Synchronous predicate
await wf.condition(() => state.status === 'complete');
```

## Symptoms

What you see depends on what the surrounding loop does between iterations:

- **Loop body schedules nothing** (the common entity-workflow shape — `while (!done) { await
  condition(...); dispatch(); }`): no commands are produced, so the workflow task never
  completes. Worker CPU pins at 100% and the SDK's deadlock detector fails the task with
  `Potential deadlock detected: workflow didn't yield within 1 second(s)`.
- **Loop body schedules a timer or activity each iteration**: the history grows by several
  events per spin until the event-count or size limit is hit and the workflow is terminated.

In neither case does the error mention the predicate — you have to know this.

## Why It's Hard to Catch

`condition` is typed `fn: () => boolean`, so a plain `async () => …` argument **is** a
compile error (`Promise<boolean>` is not assignable to `boolean`). The trap gets through
in the cases the type checker does not see:

- a predicate that is typed `any` or comes from an untyped helper;
- plain JavaScript, or a `// @ts-ignore` / `as any` left over from a refactor;
- the disguised form — a *synchronous* arrow that kicks off async work and returns a
  constant: `condition(() => { void refresh(); return ready; })`, where `ready` is set
  by the async work and so is stale until it runs;
- the SDK does not validate the predicate's return type at runtime.

TypeScript is the first line of defense; the lint rule below is defense-in-depth for the
cases above, and fires with a message that names the fix.

## Prevention

Lint for `async` functions passed to `condition()`:

```javascript
// eslint.config.js — ban async predicates in condition()
{
  rules: {
    'no-restricted-syntax': ['error', {
      selector: 'CallExpression[callee.property.name="condition"] > :matches(ArrowFunctionExpression, FunctionExpression)[async=true]',
      message: 'condition() predicates must be synchronous. Remove async.',
    }],
  },
}
```

## See Also

- [State Machine Driver](../patterns/state-machine-driver/) — the driver owns the single
  `condition()` loop so individual state functions never write one
- [Enforcement Mechanisms](../reference/enforcement-mechanisms.md) — where this lint rule sits
  in the enforcement hierarchy
