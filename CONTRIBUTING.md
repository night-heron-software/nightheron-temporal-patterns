# Contributing

This repository is documentation, but it is held to the standard of code: every rule in
`AGENTS.md` is checked, and every TypeScript example is type-checked against the real
Temporal SDK.

## Setup

```bash
npm install
npm run check
```

`npm run check` runs, in order: markdownlint, the structure rules, the catalog/README
consistency check, the example type-check, and the link check. CI runs the same five
steps on every pull request and re-runs the link check weekly.

## Adding a pattern

1. Create `patterns/<kebab-name>/README.md` from the **Pattern Template** in the README.
   Until it is written, it may be a *stub*: a title, a `> one-sentence summary`, and the
   line `<!-- TODO: Full pattern writeup -->`.
2. Add a row to the right section of the catalog table in `README.md`. Mark it 🔲 while
   it is a stub and ✅ once the TODO marker is gone — `check:catalog` fails on drift.
3. Write it. Problem → Solution → Example → Provenance → Gotchas → References, in that
   order; `check:structure` enforces the order and the mermaid-only diagram rule.
4. Link related patterns and gotchas in **References**, and add a back-link from any
   gotcha the pattern cites.

## Adding a gotcha

Create `gotchas/<kebab-name>.md` from the **Gotcha Template** in the README (The Trap →
Why … → Prevention or The Fix → See Also), add it to the README's Gotchas table, and link
it from every pattern that mentions it.

## Code blocks

Every ```` ```typescript ```` block is extracted and compiled by `check:examples`. Two
info-string annotations control that:

| Annotation | Effect |
|---|---|
| ```` ```typescript file=activities.ts ```` | Written to that filename, so other blocks on the same page can `import './activities'`. Use it whenever the prose labels the block with a filename. |
| ```` ```typescript fragment ```` | Skipped. For deliberately partial snippets — a ❌/✅ pair, a single expression, a block that omits its imports on purpose. |

Unresolved *domain* helpers (`notifyWarehouse`, `calculateTax`, …) and missing
third-party modules (`cassandra-driver`) are tolerated; anything involving the SDK's own
types is not. If a block fails for a reason you believe is noise, prefer fixing the block
(add the import, define the type) over marking it `fragment`.

## Verifying claims about the SDK

Before writing that an API exists, what it is typed as, or what it does on replay, check
the `@temporalio/*` type definitions in `node_modules` — the catalog has shipped
confidently-worded claims that were wrong, and the example check exists because of it.
When a claim cannot be expressed in a compiling example, cite the doc page that states it.

## Commits and branches

Branch per change, merge with a merge commit (no squash, no rebase-merge). Commit
messages use a conventional prefix (`feat:`, `fix:`, `docs:`, `chore:`).
