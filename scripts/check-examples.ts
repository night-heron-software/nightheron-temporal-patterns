/**
 * Extract every ```typescript block into .examples/ and type-check it against the real
 * @temporalio/* packages. Two info-string annotations are honoured:
 *
 *   ```typescript file=activities.ts   → written as that filename, so sibling blocks in the
 *                                        same page can `import './activities'`
 *   ```typescript fragment             → deliberately partial; skipped
 *
 * Blocks are type-checked leniently: unresolved *domain* names (helpers the page never
 * defines), missing third-party modules, and the implicit-any noise that follows from them
 * are ignored. Everything else — a wrong @temporalio import, a misspelled option, a call
 * that doesn't match the SDK's types, a `satisfies` mismatch — fails the check.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fences, markdownFiles, Problems, read, ROOT } from './lib/markdown.ts';

const OUT = join(ROOT, '.examples');
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

interface Origin { md: string; fenceLine: number }
const origins = new Map<string, Origin>();   // .examples-relative path → source
let extracted = 0;
let skipped = 0;

for (const md of markdownFiles()) {
  const blocks = fences(read(md)).filter((f) => f.lang === 'typescript' || f.lang === 'ts');
  if (blocks.length === 0) continue;
  const dir = md.replace(/\.md$/, '').replace(/\//g, '__');
  let n = 0;
  for (const f of blocks) {
    n += 1;
    if (f.attrs.fragment) { skipped += 1; continue; }
    const name = typeof f.attrs.file === 'string' ? f.attrs.file : `block-${n}.ts`;
    const rel = join(dir, name);
    const abs = join(OUT, rel);
    mkdirSync(dirname(abs), { recursive: true });
    // `export {}` forces module scope so two blocks may both declare `const worker`.
    writeFileSync(abs, `${f.body}\nexport {};\n`);
    origins.set(rel, { md, fenceLine: f.line });
    extracted += 1;
  }
}

writeFileSync(join(OUT, 'tsconfig.json'), JSON.stringify({
  compilerOptions: {
    target: 'ES2022',
    lib: ['ES2022'],            // no DOM: `Worker`/`fetch` must come from the SDK / @types/node
    module: 'ESNext',
    moduleResolution: 'Bundler',
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    esModuleInterop: true,
    allowImportingTsExtensions: true,
    types: ['node'],
    typeRoots: ['../node_modules/@types'],
    baseUrl: '..',
  },
  include: ['./**/*.ts'],
}, null, 2));

console.log(`  ${extracted} blocks extracted, ${skipped} fragments skipped`);

/** Diagnostics that are noise from missing domain stand-ins, not SDK misuse. */
function ignorable(code: number, message: string): boolean {
  switch (code) {
    case 2304: // Cannot find name 'x'
    case 2552: // Cannot find name 'x'. Did you mean 'y'?
    case 2582: case 2593: // Cannot find name 'describe' (test runner types)
    case 18004: // No value exists in scope for the shorthand property (a missing name, again)
    case 2503: // Cannot find namespace
    case 7005: case 7006: case 7031: case 7034: // implicit any (follows from the above)
    case 18046: // 'x' is of type 'unknown' (follows from untyped JSON.parse / response.json)
      return true;
    case 2307: // Cannot find module — fatal only for the SDK and node built-ins
      return !/'(@temporalio\/|node:)/.test(message);
    default:
      return false;
  }
}

let output = '';
try {
  execFileSync('npx', ['tsc', '-p', join(OUT, 'tsconfig.json'), '--pretty', 'false'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
} catch (err) {
  output = String((err as { stdout?: string }).stdout ?? '') + String((err as { stderr?: string }).stderr ?? '');
}

const problems = new Problems();
let ignored = 0;
for (const line of output.split('\n')) {
  const m = /^(.+?)\((\d+),(\d+)\): error TS(\d+): (.*)$/.exec(line.trim());
  if (!m) continue;
  const [, file, row, , codeStr, message] = m;
  const code = Number(codeStr);
  if (ignorable(code, message)) { ignored += 1; continue; }
  const rel = file.replace(/^.*?\.examples\//, '');
  const origin = origins.get(rel);
  if (origin) problems.add(origin.md, origin.fenceLine + Number(row), `TS${code}: ${message}  [${rel}]`);
  else problems.add(rel, Number(row), `TS${code}: ${message}`);
}
console.log(`  ${ignored} diagnostics ignored as domain-stand-in noise`);
problems.report('examples');
