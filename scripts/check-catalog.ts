/**
 * README catalog table ⇔ patterns/ directories ⇔ stub state.
 *   - every patterns/<name>/ directory appears in the README exactly once, and vice versa
 *   - ✅ marks a written pattern, 🔲 marks a stub (has the TODO marker) — no drift
 *   - every gotcha and reference file appears in its README table
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { markdownFiles, Problems, read, ROOT } from './lib/markdown.ts';

const problems = new Problems();
const readme = read('README.md');
const STUB_MARKER = '<!-- TODO: Full pattern writeup -->';

const dirs = readdirSync(join(ROOT, 'patterns')).filter((d) => existsSync(join(ROOT, 'patterns', d, 'README.md'))).sort();
const rowRe = /^\|\s*(✅|🔲)\s*\[[^\]]+\]\(patterns\/([^/)]+)\/\)\s*\|/gm;
const rows = new Map<string, { marker: string; count: number }>();
for (const m of readme.matchAll(rowRe)) {
  const entry = rows.get(m[2]) ?? { marker: m[1], count: 0 };
  entry.count += 1;
  rows.set(m[2], entry);
}

for (const d of dirs) {
  const row = rows.get(d);
  if (!row) { problems.add('README.md', null, `patterns/${d}/ is not in the catalog table`); continue; }
  if (row.count > 1) problems.add('README.md', null, `patterns/${d}/ appears ${row.count} times in the catalog table`);
  const isStub = read(`patterns/${d}/README.md`).includes(STUB_MARKER);
  const expected = isStub ? '🔲' : '✅';
  if (row.marker !== expected) problems.add('README.md', null, `patterns/${d}/ is marked ${row.marker} but is ${isStub ? 'a stub' : 'written'} — should be ${expected}`);
}
for (const name of rows.keys()) {
  if (!dirs.includes(name)) problems.add('README.md', null, `catalog lists patterns/${name}/ which does not exist`);
}

for (const file of markdownFiles()) {
  if (/^gotchas\/.+\.md$/.test(file) || /^reference\/.+\.md$/.test(file)) {
    if (!readme.includes(`](${file})`)) problems.add('README.md', null, `${file} is not linked from the README`);
  }
}

const written = dirs.filter((d) => !read(`patterns/${d}/README.md`).includes(STUB_MARKER)).length;
console.log(`  ${dirs.length} patterns (${written} written, ${dirs.length - written} stubs)`);
problems.report('catalog');
