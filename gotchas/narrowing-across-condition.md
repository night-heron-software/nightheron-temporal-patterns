# TypeScript Narrowing Breaks Across `condition()` Yields

> TypeScript narrows a variable after a null check, but `condition()` yields the
> workflow — signal handlers can reassign the variable during the yield, and
> TypeScript doesn't know this.

## The Trap

```typescript
let checkoutResult: CheckoutResult | null = null;

// Signal handler sets it during a yield
setHandler(checkoutCompletedSignal, (result) => {
  checkoutResult = result;
});

// Wait for the signal
await wf.condition(() => checkoutResult !== null);

// ❌ TypeScript narrows checkoutResult to 'never' here
// because it doesn't know the signal handler ran during the yield
if (checkoutResult !== null) {
  // TypeScript thinks this is dead code
}
```

## The Fix

Use a getter function to defeat TypeScript's control-flow narrowing:

```typescript
const getResult = () => checkoutResult;

await wf.condition(() => getResult() !== null);

if (getResult() !== null) {
  const result = getResult()!;
  applyCheckoutResult(result);
}
```

The getter is opaque to TypeScript's control-flow analysis, so it doesn't narrow
the return type.

## Why This Is TypeScript-Specific

This gotcha does not appear in Go or Java Temporal SDKs. TypeScript's control-flow
narrowing assumes that assignments between a check and its use happen synchronously —
a reasonable assumption in most code, but wrong for Temporal workflows where
`condition()` yields to signal handlers.
