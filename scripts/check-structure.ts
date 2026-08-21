/**
 * Structural rules from AGENTS.md:
 *   3. non-stub patterns follow Problem → Solution → Example → Provenance → Gotchas → References
 *   4. gotchas follow The Trap → … → See Also
 *   5. mermaid-only diagrams (no box-drawing characters, no ```text diagrams)
 *   2. no absolute paths, no secrets
 *   1. no links/names of non-public sibling repositories (generic shape check — the list of
 *      names is deliberately NOT in this repo)
 */
import { fences, headings, markdownFiles, Problems, read, withoutFences } from './lib/markdown.ts';

const problems = new Problems();
const PATTERN_ORDER = ['Problem', 'Solution', 'Example', 'Provenance', 'Gotchas', 'References'];
const STUB_MARKER = '<!-- TODO: Full pattern writeup -->';

const FORBIDDEN: Array<{ re: RegExp; why: string }> = [
  { re: /\/Users\/[A-Za-z0-9._-]+/, why: 'absolute macOS home path' },
  { re: /\/home\/[A-Za-z0-9._-]+\//, why: 'absolute Linux home path' },
  { re: /AKIA[0-9A-Z]{16}/, why: 'looks like an AWS access key id' },
  { re: /\b\d{12}\b(?=.*(?:aws|account|arn))/i, why: 'looks like an AWS account id' },
  { re: /github\.com\/(?!temporalio\/)[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+/, why: 'link to a GitHub repo other than temporalio/* (rule 1: self-contained)' },
  { re: /nightheron-(?!temporal-patterns)[a-z0-9-]+/, why: 'names a sibling nightheron-* repository (rule 1: self-contained)' },
];

for (const file of markdownFiles()) {
  const md = read(file);
  const hs = headings(md);
  const isPattern = /^patterns\/[^/]+\/README\.md$/.test(file);
  const isGotcha = /^gotchas\/[^/]+\.md$/.test(file);
  const isStub = md.includes(STUB_MARKER);

  // Title + one-sentence summary blockquote for everything under patterns/ and gotchas/
  if (isPattern || isGotcha) {
    if (!hs[0] || hs[0].level !== 1 || hs[0].line !== 1) problems.add(file, 1, 'must start with a level-1 title on line 1');
    const afterTitle = md.split('\n').slice(1, 6).join('\n');
    if (!/^\s*\n> /m.test(afterTitle)) problems.add(file, 3, 'title must be followed by a "> one-sentence summary" blockquote');
  }

  if (isPattern && !isStub) {
    const h2 = hs.filter((h) => h.level === 2).map((h) => h.text.replace(/[`*]/g, '').trim());
    const required = PATTERN_ORDER.map((name) => h2.findIndex((t) => t === name || t.startsWith(`${name}:`) || t.startsWith(`${name} `)));
    PATTERN_ORDER.forEach((name, i) => {
      if (required[i] === -1) problems.add(file, null, `missing "## ${name}" section`);
    });
    const present = required.filter((i) => i !== -1);
    if (present.some((v, i) => i > 0 && v < present[i - 1])) {
      problems.add(file, null, `sections out of order; expected ${PATTERN_ORDER.join(' → ')}`);
    }
  }
  if (isPattern && isStub) {
    if (hs.length !== 1) problems.add(file, null, 'a stub has only a title and summary — either finish it or remove the TODO marker');
  }

  if (isGotcha) {
    const h2 = hs.filter((h) => h.level === 2).map((h) => h.text.trim());
    if (h2[0] !== 'The Trap') problems.add(file, null, 'first section of a gotcha must be "## The Trap"');
    if (!h2.some((t) => /^Why\b/.test(t))) problems.add(file, null, 'gotcha needs a "## Why …" section');
    if (!h2.some((t) => /^(Prevention|The Fix)\b/.test(t))) problems.add(file, null, 'gotcha needs "## Prevention" or "## The Fix"');
    if (h2[h2.length - 1] !== 'See Also') problems.add(file, null, 'last section of a gotcha must be "## See Also" (links back to the patterns that cite it)');
  }

  // Mermaid-only diagrams
  const prose = withoutFences(md);
  for (const f of fences(md)) {
    if (/[┌┐└┘├┤┬┴┼│─╔╗╚╝║═]/.test(f.body)) problems.add(file, f.line, 'box-drawing characters in a code block — use a ```mermaid diagram (rule 5)');
    if (f.lang === '' && /-->|->|==>/.test(f.body) && f.body.split('\n').length > 2) problems.add(file, f.line, 'untyped fenced block that looks like a diagram — use ```mermaid (rule 5)');
  }
  if (/[┌┐└┘├┤┬┴┼│─]/.test(prose)) problems.add(file, null, 'box-drawing characters outside a code block (rule 5)');

  // Forbidden content
  md.split('\n').forEach((line, i) => {
    for (const { re, why } of FORBIDDEN) {
      if (re.test(line)) problems.add(file, i + 1, `${why}: ${line.trim().slice(0, 100)}`);
    }
  });
}

problems.report('structure');
