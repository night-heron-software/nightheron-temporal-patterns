# No Dynamic Imports in Workflow Code

> Dynamic `import()` calls in workflow code bypass the deterministic sandbox bundling
> and can introduce non-determinism.

## The Trap

Temporal bundles workflow code into a deterministic V8 sandbox at worker startup. The
bundler follows static `import` statements to capture the complete module graph.
Dynamic `import()` calls are evaluated at runtime, after the bundle is built — they
bypass the sandbox and can load non-deterministic code.

```typescript
// ❌ WRONG: Dynamic import in workflow
const module = await import(`./strategies/${type}`);
await module.execute(input);

// ✅ CORRECT: Static imports, dynamic dispatch
import { runSimulated } from './strategies/simulated';
import { runDynamic } from './strategies/dynamic';

if (type === 'simulated') await runSimulated(input);
else if (type === 'dynamic') await runDynamic(input);
else throw new Error(`Unknown strategy type: ${type}`);
```

## Why It Matters

1. **The dynamically imported module is not captured in the bundle.** It won't be
   available in the V8 isolate, causing a runtime `ModuleNotFoundError`.

2. **Even if it resolves**, the imported code runs outside the sandbox's determinism
   guarantees — `Math.random()` and `Date.now()` are not intercepted.

3. **The error surfaces at runtime during the import**, not at build time, making it
   hard to catch in tests that don't exercise every code path.

## Prevention

Ban dynamic imports in workflow files:

```javascript
// eslint.config.js
{
  rules: {
    'no-restricted-syntax': ['error', {
      selector: 'ImportExpression',
      message: 'Dynamic import() is forbidden in workflow code. Use static imports.',
    }],
  },
  files: ['**/workflows.ts', '**/workflows/**/*.ts'],
}
```
