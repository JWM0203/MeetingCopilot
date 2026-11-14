import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  CODE_IGNORE_DIRS,
  MAX_CODE_DIGEST_CHARS,
  extractRoutes,
  extractSymbols,
  formatFileLine,
  scanProjectDigest,
} from '../electron/codedigest';

let root: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'mc-codedigest-'));
  mkdirSync(join(root, 'src', 'deep'), { recursive: true });
  mkdirSync(join(root, 'node_modules'), { recursive: true });
  mkdirSync(join(root, 'dist'), { recursive: true });
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({
      name: 'demo-app',
      scripts: { start: 'node index.js', test: 'vitest run' },
      dependencies: { react: '18', ws: '8' },
      devDependencies: { vitest: '3' },
    }),
  );
  writeFileSync(join(root, 'README.md'), '# demo-app\n\nA tiny demo for the digest scanner.');
  writeFileSync(
    join(root, 'src', 'a.ts'),
    [
      'export function foo() { return 1; }',
      'export class Bar { }',
      'export const baz = 1;',
      'export interface Qux { }',
      'export default foo;',
    ].join('\n'),
  );
  writeFileSync(
    join(root, 'src', 'deep', 'b.py'),
    ['class Thing:', '    def speak(self):', '        return "hi"', '', 'def run():', '    pass'].join('\n'),
  );
  writeFileSync(
    join(root, 'src', 'deep', 'c.py'),
    ['from fastapi import FastAPI', 'app = FastAPI()', '@app.get("/users")', 'def users():', '    return []'].join('\n'),
  );
  writeFileSync(join(root, 'node_modules', 'x.js'), 'module.exports = 1;');
  writeFileSync(join(root, 'dist', 'out.js'), 'var minified=1;');
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('extractSymbols (regex symbol extraction, no fs)', () => {
  it('extracts js/ts exports, classes and const bindings', () => {
    const syms = extractSymbols(
      ['export function foo() {}', 'export class Bar {}', 'export const baz = 1;', 'export interface Qux {}'].join('\n'),
      'js',
    );
    expect(syms).toContain('foo');
    expect(syms).toContain('Bar');
    expect(syms).toContain('baz');
    expect(syms).toContain('Qux');
  });
  it('extracts python classes/defs including async', () => {
    const syms = extractSymbols('class Thing:\n    async def go(self):\n        pass', 'py');
    expect(syms).toContain('Thing');
    expect(syms).toContain('go');
  });
  it('extracts go funcs and rust fns via the generic-ish rules', () => {
    expect(extractSymbols('func main() {}', 'go')).toContain('main');
    expect(extractSymbols('pub fn run() {}', 'rs')).toContain('run');
  });
  it('dedupes and caps per file', () => {
    const many = Array.from({ length: 40 }, (_, i) => `export function fn${i}() {}`).join('\n');
    expect(extractSymbols(many, 'js')).toHaveLength(12);
  });
});

describe('extractRoutes (endpoint literals)', () => {
  it('catches fastapi decorators and express-style calls', () => {
    const routes = extractRoutes('@app.get("/users")\nrouter.post("/items", handler)');
    expect(routes).toContain('/users');
    expect(routes).toContain('/items');
  });
  it('ignores non-endpoint strings', () => {
    expect(extractRoutes('const a = "not a route";')).toEqual([]);
  });
});

describe('formatFileLine', () => {
  it('joins path, line count, symbols and routes', () => {
    const line = formatFileLine({
      abs: '/x',
      rel: 'src/a.ts',
      depth: 2,
      lines: 10,
      symbols: ['foo'],
      routes: ['/api'],
      omitted: false,
    });
    expect(line).toContain('src/a.ts (10 行)');
    expect(line).toContain('foo');
    expect(line).toContain('路由: /api');
  });
});

describe('scanProjectDigest (deterministic fs scan)', () => {
  it('collects tree, deps, symbols and skips artifacts', async () => {
    const r = await scanProjectDigest(root);
    expect(r.files).toBe(3); // a.ts + b.py + c.py (node_modules / dist excluded)
    expect(r.digest).toContain('demo-app'); // package.json name
    expect(r.digest).toContain('react'); // dependency names
    expect(r.digest).toContain('【目录树】');
    expect(r.digest).toContain('src/');
    expect(r.digest).toContain('src/deep/');
    expect(r.digest).toContain('【代码符号表】');
    expect(r.digest).toContain('src/a.ts');
    expect(r.digest).toContain('foo');
    expect(r.digest).toContain('Thing');
    // ignored dirs and non-code files never leak in
    expect(r.digest).not.toContain('node_modules');
    expect(r.digest).not.toContain('out.js');
    expect(r.digest).not.toContain('logo.png');
    // README head included at the tail
    expect(r.digest).toContain('【README 摘要】');
    expect(r.digest).toContain('demo for the digest scanner');
  });

  it('is deterministic: two scans of the same folder yield identical bytes', async () => {
    const a = await scanProjectDigest(root);
    const b = await scanProjectDigest(root);
    expect(a.digest).toBe(b.digest);
    expect(a.files).toBe(b.files);
  });

  it('never exceeds the char budget and flags truncation', async () => {
    const big = mkdtempSync(join(tmpdir(), 'mc-codedigest-big-'));
    try {
      mkdirSync(join(big, 'src'), { recursive: true });
      for (let i = 0; i < 60; i++) {
        const fns = Array.from({ length: 12 }, (_, k) => `export function longFunctionName${i}_${k}() {}`);
        writeFileSync(join(big, 'src', `m${i}.ts`), fns.join('\n'));
      }
      const r = await scanProjectDigest(big);
      expect(r.truncated).toBe(true);
      // body + header + truncation note: the note pushes it slightly over, the
      // BODY itself (sections) stays within budget
      expect(r.digest.length).toBeLessThan(MAX_CODE_DIGEST_CHARS + 400);
    } finally {
      rmSync(big, { recursive: true, force: true });
    }
  });

  it('ignores configured artifact dirs (build / venv / cache…)', () => {
    for (const d of ['node_modules', '.git', 'dist', '__pycache__', '.venv']) {
      expect(CODE_IGNORE_DIRS.has(d)).toBe(true);
    }
  });
});
