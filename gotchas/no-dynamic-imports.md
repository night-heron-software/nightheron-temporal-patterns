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

1. **The bundler cannot resolve a computed specifier.** With a fully dynamic string the
   module is simply absent from the bundle and the first workflow task that takes that
   branch fails with a module-not-found error. With a partially static string
   (`./strategies/${type}`) webpack may instead build a *context* — every file in the
   directory is pulled in, including ones never meant to run in the sandbox, and the
   sandbox's disallowed-module check sees them only if they are reachable statically.

2. **The failure surfaces at runtime**, on the first execution that takes the branch, not
   at build time — so it slips past tests that do not exercise every strategy.

3. **It buys nothing.** The whole bundle is already loaded into the isolate; lazy loading
   saves no memory or startup time. What it costs is legibility: the reader, the linter,
   and the bundler can no longer tell which modules are workflow code.

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

## See Also

- [Two-File Activity](../patterns/two-file-activity/) — the structural boundary that keeps
  I/O modules out of the static graph in the first place
- [Worker Restart and Replay](worker-restart-replay.md) — what the sandbox does guarantee
