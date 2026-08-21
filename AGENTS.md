# AGENTS.md — nightheron-temporal-patterns

Canonical guidance for AI agents working in this repository.

## What this repo is

A public reference catalog of Temporal TypeScript patterns. Each pattern has a problem
statement, solution, annotated code examples, provenance, and gotchas. The repo is
documentation only — no runnable application code.

## Hard rules

1. **Self-contained.** This repo never names, links to, or describes any other repository.
   It is the canonical upstream — other projects link TO pattern pages here. Code examples
   use neutral domain names (`orderWorkflow`, `cartWorkflow`, `itemWorkflow`).
2. **No secrets, no absolute paths.** Nothing tracked may contain API keys, `/Users/...`
   paths, AWS account IDs, or org-specific identifiers.
3. **Pattern template.** Every `patterns/<name>/README.md` follows the template in the
   project README: Problem → Solution → Example → Provenance → Gotchas → References.
4. **Mermaid-only diagrams.** Use ` ```mermaid ` fenced blocks; never ASCII/box-art.
5. **No silent fallbacks** in code examples. Show explicit error handling.

## Quality gates

```bash
# All files are valid markdown
# No sibling repo names or absolute paths
# Pattern template structure is consistent
```

## Key files

| Path | What |
|---|---|
| `README.md` | Overview, catalog table, pattern template |
| `patterns/<name>/README.md` | One pattern per directory |
| `gotchas/*.md` | TypeScript-specific pitfalls |
| `reference/enforcement-mechanisms.md` | How to make patterns stick (lint, guards, ratchets) |
