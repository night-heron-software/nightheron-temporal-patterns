# Async Predicate Death Loop

> Passing an `async` function to `wf.condition()` creates an infinite loop that burns
> through the event history in seconds.

## The Trap

`wf.condition()` takes a **synchronous** predicate. If you pass an `async` function,
it returns a `Promise` — which is always truthy in JavaScript. The condition resolves
immediately, the workflow advances, evaluates the condition again (still truthy),
advances again, and repeats until the history size limit is hit.

```typescript
// ❌ DEATH LOOP: Promise is always truthy
await wf.condition(async () => {
  return state.status === 'complete';
});

// ✅ CORRECT: Synchronous predicate
await wf.condition(() => state.status === 'complete');
```

## Symptoms

- Worker CPU spikes to 100%
- The workflow generates thousands of events in milliseconds
- Eventually hits the Temporal event history size limit
- The error message does **not** mention the async predicate — you have to know this

## Why It's Hard to Catch

- TypeScript does not warn about this — `async () => boolean` is assignable to
  `() => boolean` because a Promise is truthy
- The behavior looks like an infinite loop in the workflow logic, not a predicate issue
- The SDK does not validate that the predicate is synchronous at runtime

## Prevention

Lint for `async` functions passed to `condition()`:

```javascript
// eslint.config.js — ban async predicates in condition()
{
  rules: {
    'no-restricted-syntax': ['error', {
      selector: 'CallExpression[callee.property.name="condition"] > ArrowFunctionExpression[async=true]',
      message: 'condition() predicates must be synchronous. Remove async.',
    }],
  },
}
```
