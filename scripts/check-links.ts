/**
 * Every link in every markdown file resolves:
 *   - relative links → the file (and directory README) exists; #fragments match a heading
 *   - http(s) links → 2xx/3xx (GET, browser-ish UA, 3 attempts); example/localhost hosts skipped
 */
import { existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { headings, markdownFiles, Problems, read, ROOT, withoutFences } from './lib/markdown.ts';

const problems = new Problems();
const SKIP_HOSTS = /(^|\.)(example|test|invalid|localhost)(:\d+)?$/;
const external = new Map<string, Array<{ file: string; line: number }>>();

function slug(text: string): string {
  return text.toLowerCase().replace(/[`*_]/g, '').replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s+/g, '-');
}

for (const file of markdownFiles()) {
  const md = read(file);
  const prose = withoutFences(md);
  const lines = prose.split('\n');
  lines.forEach((line, i) => {
    for (const m of line.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      const target = m[1];
      if (/^https?:\/\//.test(target)) {
        try {
          const host = new URL(target).hostname;
          if (SKIP_HOSTS.test(host)) continue;
        } catch { problems.add(file, i + 1, `malformed URL ${target}`); continue; }
        const list = external.get(target) ?? [];
        list.push({ file, line: i + 1 });
        external.set(target, list);
        continue;
      }
      if (/^mailto:/.test(target)) continue;
      const [pathPart, fragment] = target.split('#');
      let abs: string;
      if (pathPart === '') abs = join(ROOT, file);
      else abs = resolve(ROOT, dirname(file), pathPart);
      if (!existsSync(abs)) { problems.add(file, i + 1, `broken relative link ${target}`); continue; }
      let targetFile = abs;
      if (statSync(abs).isDirectory()) {
        targetFile = join(abs, 'README.md');
        if (!existsSync(targetFile)) { problems.add(file, i + 1, `directory link ${target} has no README.md`); continue; }
      }
      if (fragment) {
        const hs = headings(read(targetFile.slice(ROOT.length + 1))).map((h) => slug(h.text));
        if (!hs.includes(fragment.toLowerCase())) problems.add(file, i + 1, `fragment #${fragment} not found in ${target.split('#')[0] || file}`);
      }
    }
  });
}

async function check(url: string): Promise<string | null> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; nightheron-temporal-patterns link check)' },
        signal: AbortSignal.timeout(20_000),
      });
      if (res.ok || (res.status >= 300 && res.status < 400)) return null;
      if (res.status === 429 || res.status >= 500) { await new Promise((r) => setTimeout(r, 1500 * attempt)); continue; }
      return `HTTP ${res.status}`;
    } catch (err) {
      if (attempt === 3) return `fetch failed: ${(err as Error).message}`;
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  return 'unreachable after 3 attempts';
}

const urls = [...external.keys()];
console.log(`  ${urls.length} unique external URLs`);
const CONCURRENCY = 8;
let next = 0;
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (next < urls.length) {
    const url = urls[next++];
    const err = await check(url);
    if (err) for (const { file, line } of external.get(url)!) problems.add(file, line, `${err}: ${url}`);
  }
}));
problems.report('links');
