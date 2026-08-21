# AGENTS.md — nightheron-temporal-patterns

Canonical guidance for AI agents working in this repository.

## What this repo is

A public reference catalog of Temporal TypeScript patterns. Each pattern has a problem
statement, solution, annotated code examples, provenance, and gotchas. The repo is
documentation only — the code examples are type-checked against the real SDK but there is
no runnable application.

## Hard rules

1. **Self-contained.** This repo never names or links to any other non-public repository.
   It is the canonical upstream — other projects link TO pattern pages here. Anonymized
   descriptions of where a pattern came from ("a multi-tenant commerce platform with eight
   domain workers") are fine and belong in Provenance; repository names, org names, and
   links are not. Code examples use neutral domain names (`orderWorkflow`, `cartWorkflow`,
   `itemWorkflow`).
2. **No secrets, no absolute paths.** Nothing tracked may contain API keys, home-directory
   paths such as `/Users/<name>/…`, AWS account IDs, or org-specific identifiers.
3. **Pattern template.** Every non-stub `patterns/<name>/README.md` follows the template in
   the project README: Problem → Solution → Example → Provenance → Gotchas → References.
   A stub is a title, a one-sentence summary, and `<!-- TODO: Full pattern writeup -->`.
4. **Gotcha template.** Every `gotchas/*.md` follows: The Trap → (Symptoms) → Why → Prevention
   or Fix → See Also. Each gotcha links back to the patterns that cite it.
5. **Mermaid-only diagrams.** Use ` ```mermaid ` fenced blocks; never ASCII/box-art.
6. **No silent fallbacks** in code examples. Show explicit error handling.
7. **Claims about the SDK are verified, not remembered.** Before stating what an API is
   called, what it is typed as, or what it does on replay, check the `@temporalio/*` type
   definitions. The example blocks compile in CI for the same reason.
8. **Say it once.** A fact that applies to several patterns (e.g. "workers do not
   hot-reload workflow code") lives in one place — usually a gotcha — and the others link
   to it.

## Quality gates

```bash
npm run check            # everything below
npm run check:lint       # markdownlint
npm run check:links      # every external link resolves
npm run check:structure  # templates, mermaid-only, no absolute paths, no forbidden names
npm run check:catalog    # README table ⇔ patterns/ directories, ✅/🔲 markers ⇔ stub state
npm run check:examples   # extract ```typescript blocks and tsc --noEmit them against the SDK
```

## Key files

| Path | What |
|---|---|
| `README.md` | Overview, catalog table, pattern + gotcha templates |
| `patterns/<name>/README.md` | One pattern per directory |
| `gotchas/*.md` | TypeScript-specific pitfalls |
| `reference/enforcement-mechanisms.md` | How to make patterns stick (lint, guards, replay tests, ratchets) |
| `scripts/` | The quality-gate checks |
| `CONTRIBUTING.md` | How to add a pattern and run the checks |
