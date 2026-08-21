import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

export const ROOT = new URL('../../', import.meta.url).pathname.replace(/\/$/, '');

/** Every tracked markdown file, as repo-relative paths, deterministic order. */
export function markdownFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      if (name === 'node_modules' || name === '.git' || name === '.examples') continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith('.md')) out.push(relative(ROOT, full));
    }
  };
  walk(ROOT);
  return out;
}

export function read(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8');
}

export interface Fence {
  /** info string after the backticks, e.g. "typescript file=activities.ts" */
  info: string;
  lang: string;
  /** key=value and bare-word attributes from the info string */
  attrs: Record<string, string | true>;
  body: string;
  /** 1-based line of the opening fence */
  line: number;
}

/** Parse fenced code blocks. Handles ``` and ~~~ fences of length >= 3. */
export function fences(md: string): Fence[] {
  const lines = md.split('\n');
  const out: Fence[] = [];
  let open: { marker: string; info: string; start: number; body: string[] } | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (!open) {
      if (m) open = { marker: m[1], info: m[2].trim(), start: i + 1, body: [] };
      continue;
    }
    if (m && m[1][0] === open.marker[0] && m[1].length >= open.marker.length && m[2].trim() === '') {
      const [lang = '', ...rest] = open.info.split(/\s+/);
      const attrs: Record<string, string | true> = {};
      for (const token of rest) {
        const eq = token.indexOf('=');
        if (eq === -1) attrs[token] = true;
        else attrs[token.slice(0, eq)] = token.slice(eq + 1).replace(/^"|"$/g, '');
      }
      out.push({ info: open.info, lang, attrs, body: open.body.join('\n'), line: open.start });
      open = null;
    } else {
      open.body.push(line);
    }
  }
  return out;
}

/** Heading text for every ATX heading, in order, with level and line. */
export function headings(md: string): Array<{ level: number; text: string; line: number }> {
  const out: Array<{ level: number; text: string; line: number }> = [];
  let inFence = false;
  let marker = '';
  md.split('\n').forEach((line, i) => {
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (f) {
      if (!inFence) { inFence = true; marker = f[1]; }
      else if (f[1][0] === marker[0] && f[1].length >= marker.length) inFence = false;
      return;
    }
    if (inFence) return;
    const h = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) out.push({ level: h[1].length, text: h[2], line: i + 1 });
  });
  return out;
}

/** Strip fenced code from markdown so prose-only checks don't trip on examples. */
export function withoutFences(md: string): string {
  let inFence = false;
  let marker = '';
  return md.split('\n').map((line) => {
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (f) {
      if (!inFence) { inFence = true; marker = f[1]; }
      else if (f[1][0] === marker[0] && f[1].length >= marker.length) inFence = false;
      return '';
    }
    return inFence ? '' : line;
  }).join('\n');
}

export class Problems {
  private items: string[] = [];
  add(file: string, line: number | null, msg: string) {
    this.items.push(line === null ? `${file}: ${msg}` : `${file}:${line}: ${msg}`);
  }
  report(title: string): never | void {
    if (this.items.length === 0) {
      console.log(`✓ ${title}`);
      return;
    }
    console.error(`✗ ${title} — ${this.items.length} problem(s)`);
    for (const p of this.items) console.error(`  ${p}`);
    process.exit(1);
  }
}
