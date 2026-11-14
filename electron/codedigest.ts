/**
 * Deterministic project-source → structure digest for the 【项目代码摘要】
 * material slot. Same philosophy as docparse.ts: NO LLM in the loop — the
 * answer path is latency-first, so the digest is a pure fs walk + regex
 * symbol extraction, bounded to a fixed char budget. The user picks a project
 * folder; we extract the directory tree, build/dependency info and a per-file
 * symbol table (exports / classes / functions / routes) — everything the
 * teleprompter needs to answer "how did you build X" from the REAL code
 * without stuffing raw sources into every request.
 *
 * Determinism contract: the same folder ALWAYS yields the same digest bytes
 * (sorted listings, fixed section order) — the digest goes into the
 * byte-stable prefix and must not break the provider KV cache.
 */
import { readFile, readdir, stat } from 'fs/promises';
import { extname, join, relative, sep } from 'path';

/** total digest budget; prompts.ts injects it whole (double-clamped there) */
export const MAX_CODE_DIGEST_CHARS = 8000;
/** stop walking after this many entries (pathological trees stay cheap) */
const MAX_WALK_ENTRIES = 4000;
/** max code files collected for the symbol table */
const MAX_FILES = 300;
/** per-file read cap for symbol extraction (big data/minified files) */
const MAX_FILE_BYTES = 96 * 1024;
/** tree: depth and entry caps */
const MAX_TREE_DEPTH = 3;
const MAX_TREE_ENTRIES = 120;
/** per-config-file excerpt cap */
const MAX_CONFIG_CHARS = 500;
/** README head excerpt cap */
const MAX_README_CHARS = 600;
/** symbols / routes kept per file */
const MAX_SYMBOLS_PER_FILE = 12;
const MAX_ROUTES_PER_FILE = 8;

/** dependency/build artifacts and VCS internals — never scanned */
export const CODE_IGNORE_DIRS = new Set([
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  'dist',
  'build',
  'out',
  'release',
  '.next',
  '.nuxt',
  '.output',
  '.vite',
  'coverage',
  '.nyc_output',
  '.cache',
  '.parcel-cache',
  '.gradle',
  '.idea',
  '.vscode',
  '.venv',
  'venv',
  'env',
  '.tox',
  '.mypy_cache',
  '.pytest_cache',
  '__pycache__',
  'site-packages',
  'target',
  'vendor',
  'Pods',
  '.terraform',
  'bin',
  'obj',
]);

/** lockfiles and minified bundles carry no interview-relevant structure */
const SKIP_FILE_NAMES = new Set([
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'poetry.lock',
  'Pipfile.lock',
  'composer.lock',
  'Cargo.lock',
  'Gemfile.lock',
]);

const CODE_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'cts',
  'vue', 'svelte', 'astro',
  'py', 'java', 'kt', 'kts', 'go', 'rs', 'rb', 'php', 'swift', 'm', 'mm',
  'c', 'h', 'cc', 'cpp', 'hpp', 'hh', 'cs',
  'scala', 'dart', 'lua', 'pl', 'sql', 'proto', 'graphql', 'gql', 'tf',
  'sh', 'bash', 'zsh', 'ps1', 'bat',
  'yaml', 'yml', 'toml', 'json', 'gradle', 'groovy',
]);

/** build/dependency files excerpted verbatim (head) — high signal for tech answers */
const CONFIG_FILES = new Set([
  'package.json',
  'requirements.txt',
  'pyproject.toml',
  'go.mod',
  'Cargo.toml',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'Dockerfile',
  'docker-compose.yml',
  'docker-compose.yaml',
  'Makefile',
  'CMakeLists.txt',
]);

const README_NAMES = new Set(['README.md', 'README.rst', 'README.txt']);

type LangFamily = 'js' | 'py' | 'go' | 'rs' | 'jvm' | 'generic';

function langFamilyOf(ext: string): LangFamily {
  if (['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'cts', 'vue', 'svelte', 'astro'].includes(ext)) return 'js';
  if (ext === 'py') return 'py';
  if (ext === 'go') return 'go';
  if (ext === 'rs') return 'rs';
  if (['java', 'kt', 'kts', 'cs', 'scala', 'dart'].includes(ext)) return 'jvm';
  return 'generic';
}

/** module path relative to the project root, posix separators (stable across OS) */
function relPosix(root: string, abs: string): string {
  return relative(root, abs).split(sep).join('/');
}

interface SymbolRule {
  re: RegExp;
  group: number;
}

const SYMBOL_RULES: Record<LangFamily, SymbolRule[]> = {
  js: [
    { re: /(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s+([A-Za-z_$][\w$]*)/g, group: 1 },
    { re: /(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/g, group: 1 },
    { re: /export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g, group: 1 },
    { re: /export\s+(?:interface|type|enum)\s+([A-Za-z_$][\w$]*)/g, group: 1 },
  ],
  py: [
    { re: /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/gm, group: 1 },
    { re: /^\s*class\s+([A-Za-z_]\w*)/gm, group: 1 },
  ],
  go: [
    { re: /^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/gm, group: 1 },
    { re: /^type\s+([A-Za-z_]\w*)(?:\s+\w+)?/gm, group: 1 },
  ],
  rs: [
    { re: /^\s*(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)/gm, group: 1 },
    { re: /^\s*(?:pub\s+)?(?:struct|enum|trait|mod)\s+([A-Za-z_]\w*)/gm, group: 1 },
  ],
  jvm: [
    { re: /(?:public|private|protected)?\s*(?:final\s+|abstract\s+|static\s+|data\s+|sealed\s+)*(?:class|interface|enum|record|object)\s+([A-Za-z_]\w*)/g, group: 1 },
    { re: /^\s*(?:pub\s+)?fun\s+([A-Za-z_]\w*)/gm, group: 1 },
  ],
  generic: [
    { re: /^\s*(?:pub\s+)?(?:async\s+)?(?:def|fn|func|function|class|interface|struct|type|enum|module)\s+([A-Za-z_]\w*)/gm, group: 1 },
  ],
};

/** HTTP endpoint literals (express/fastapi/spring-style) — cheap but high-signal */
const ROUTE_RULES: SymbolRule[] = [
  { re: /(?:^|\n)\s*@(?:app|router|blueprint|api_view|Controller|GetMapping|PostMapping|RequestMapping)[\w.]*\(\s*['"`]([^'"`]+)['"`]/g, group: 1 },
  { re: /\.(?:get|post|put|delete|patch|all|use)\s*\(\s*['"`](\/[^'"`\s]*)['"`]/g, group: 1 },
];

/** dedup'd, capped symbol names for one file's content */
export function extractSymbols(content: string, family: LangFamily): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const rule of SYMBOL_RULES[family]) {
    rule.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rule.re.exec(content)) !== null) {
      const name = m[rule.group];
      if (name && !seen.has(name)) {
        seen.add(name);
        out.push(name);
        if (out.length >= MAX_SYMBOLS_PER_FILE) return out;
      }
    }
  }
  return out;
}

/** dedup'd, capped route paths for one file's content */
export function extractRoutes(content: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const rule of ROUTE_RULES) {
    rule.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rule.re.exec(content)) !== null) {
      const path = m[rule.group];
      if (path && !seen.has(path)) {
        seen.add(path);
        out.push(path);
        if (out.length >= MAX_ROUTES_PER_FILE) return out;
      }
    }
  }
  return out;
}

interface CodeFileInfo {
  abs: string;
  rel: string;
  depth: number;
  lines: number;
  symbols: string[];
  routes: string[];
  omitted: boolean; // file larger than MAX_FILE_BYTES — symbols from the head only
}

/** one `${rel} (${lines} 行) fn a, b · 路由: /x, /y` symbol-table line */
export function formatFileLine(f: CodeFileInfo): string {
  const parts: string[] = [`${f.rel} (${f.lines} 行)`];
  if (f.symbols.length) parts.push(f.symbols.join(', '));
  if (f.routes.length) parts.push(`路由: ${f.routes.join(' ')}`);
  if (f.omitted) parts.push('（超长，仅摘要头部）');
  return parts.join(' · ');
}

/** sorted tree listing (dirs first, depth-capped, entry-capped) */
function buildTree(
  root: string,
  entries: { abs: string; isDir: boolean; depth: number }[],
): string {
  const usable = entries
    .filter((e) => e.depth <= MAX_TREE_DEPTH)
    .sort((a, b) => {
      // pure path sort → proper DFS order (each dir is immediately followed
      // by its own children; parents are prefixes of their children's paths)
      return relPosix(root, a.abs).localeCompare(relPosix(root, b.abs));
    })
    .slice(0, MAX_TREE_ENTRIES);
  const lines: string[] = [];
  for (const e of usable) {
    const rel = relPosix(root, e.abs);
    lines.push(`${'  '.repeat(e.depth - 1)}${e.isDir ? rel.split('/').pop() + '/' : rel}`);
  }
  return lines.join('\n');
}

/** sorted walk collecting dirs/files (skips ignored dirs and junk file names) */
async function walk(root: string): Promise<{
  dirs: { abs: string; depth: number }[];
  files: { abs: string; ext: string; isConfig: boolean; isReadme: boolean }[];
  overflow: boolean;
}> {
  const dirs: { abs: string; depth: number }[] = [];
  const files: { abs: string; ext: string; isConfig: boolean; isReadme: boolean }[] = [];
  let visited = 0;
  let overflow = false;

  const queue: { abs: string; depth: number }[] = [{ abs: root, depth: 0 }];
  while (queue.length) {
    const { abs, depth } = queue.shift()!;
    if (++visited > MAX_WALK_ENTRIES) {
      overflow = true;
      break;
    }
    let names: string[];
    try {
      names = await readdir(abs);
    } catch {
      continue; // unreadable dir — skip silently, keep scanning the rest
    }
    for (const name of names.sort()) {
      const full = join(abs, name);
      let st;
      try {
        st = await stat(full);
      } catch {
        continue; // vanished / unreadable entry — skip
      }
      if (st.isDirectory()) {
        if (CODE_IGNORE_DIRS.has(name)) continue;
        dirs.push({ abs: full, depth: depth + 1 });
        queue.push({ abs: full, depth: depth + 1 });
      } else {
        const lower = name.toLowerCase();
        const ext = extname(lower).slice(1);
        const isConfig = CONFIG_FILES.has(name);
        const isReadme = README_NAMES.has(name);
        if (SKIP_FILE_NAMES.has(name)) continue;
        if (!isConfig && !isReadme && !CODE_EXTENSIONS.has(ext)) continue;
        files.push({ abs: full, ext, isConfig, isReadme });
      }
    }
  }
  return { dirs, files, overflow };
}

/** package.json → one compact "scripts + dependencies" line; other configs → head */
function excerptConfig(name: string, content: string): string {
  if (name === 'package.json') {
    try {
      const j = JSON.parse(content) as {
        name?: string;
        scripts?: Record<string, string>;
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const parts: string[] = [];
      if (j.name) parts.push(`name=${j.name}`);
      if (j.scripts) {
        const s = Object.entries(j.scripts).slice(0, 8).map(([k, v]) => `${k}: ${v}`);
        parts.push(`scripts{ ${s.join('; ')} }`);
      }
      const deps = Object.keys({ ...j.dependencies, ...j.devDependencies });
      if (deps.length) parts.push(`deps(${deps.length}): ${deps.slice(0, 30).join(', ')}${deps.length > 30 ? ' …' : ''}`);
      const line = `package.json · ${parts.join(' · ')}`;
      return line.length > MAX_CONFIG_CHARS ? line.slice(0, MAX_CONFIG_CHARS) + '…' : line;
    } catch {
      // fall through to the generic head excerpt
    }
  }
  const head = content.split('\n').slice(0, 12).join('\n').trim();
  const body = head.length > MAX_CONFIG_CHARS ? head.slice(0, MAX_CONFIG_CHARS) + '…' : head;
  return `${name} ·\n${body}`;
}

export interface CodeDigestResult {
  digest: string;
  /** number of code files actually folded into the symbol table */
  files: number;
  /** true when files / entries / budget were hit (digest is partial) */
  truncated: boolean;
}

/**
 * Scan a project folder into a bounded, deterministic structure digest.
 * Throws only when the root itself is unreadable — partial scans never throw.
 */
export async function scanProjectDigest(root: string): Promise<CodeDigestResult> {
  const { dirs, files, overflow: walkOverflow } = await walk(root);

  let truncated = walkOverflow;

  // ---- 1. tree (highest priority: the architecture at a glance) ----
  const tree = buildTree(root, dirs.map((d) => ({ ...d, isDir: true })));

  // ---- 2. build / dependency info ----
  const configPaths = files.filter((f) => f.isConfig).map((f) => f.abs).sort();
  const readmePaths = files.filter((f) => f.isReadme).map((f) => f.abs).sort();
  const configLines: string[] = [];
  for (const p of configPaths) {
    try {
      const content = (await readFile(p, 'utf8')).slice(0, MAX_FILE_BYTES);
      configLines.push(excerptConfig(p.split(sep).pop() ?? p, content));
    } catch {
      /* unreadable — skip */
    }
  }
  const configStr = configLines.length ? `【构建与依赖】\n${configLines.join('\n')}` : '';

  // ---- 3. per-file symbol table, shallow paths first ----
  const codeFiles = files
    .filter((f) => !f.isConfig && !f.isReadme)
    .sort((a, b) => {
      const ra = relPosix(root, a.abs);
      const rb = relPosix(root, b.abs);
      const d = ra.split('/').length - rb.split('/').length;
      return d !== 0 ? d : ra.localeCompare(rb);
    })
    .slice(0, MAX_FILES);
  if (codeFiles.length < files.filter((f) => !f.isConfig && !f.isReadme).length) truncated = true;

  const infoLines: string[] = [];
  for (const f of codeFiles) {
    let content = '';
    let lines = 0;
    let omitted = false;
    try {
      const buf = await readFile(f.abs, 'utf8');
      lines = buf.split('\n').length;
      content = buf.length > MAX_FILE_BYTES ? buf.slice(0, MAX_FILE_BYTES) : buf;
      omitted = buf.length > MAX_FILE_BYTES;
      const rel = relPosix(root, f.abs);
      const info: CodeFileInfo = {
        abs: f.abs,
        rel,
        depth: rel.split('/').length,
        lines,
        symbols: extractSymbols(content, langFamilyOf(f.ext)),
        routes: extractRoutes(content),
        omitted,
      };
      infoLines.push(formatFileLine(info));
    } catch {
      /* unreadable — skip */
    }
  }
  // ---- 4. README head (lowest priority) ----
  let readmeStr = '';
  if (readmePaths.length) {
    try {
      const head = (await readFile(readmePaths[0], 'utf8')).trim().slice(0, MAX_README_CHARS);
      if (head) readmeStr = `【README 摘要】\n${head}${head.length >= MAX_README_CHARS ? '…' : ''}`;
    } catch {
      /* skip */
    }
  }

  // ---- deterministic assembly, priority order: tree → config → symbol
  // table (clipped LINE BY LINE, so a large repo still surfaces its shallowest
  // files instead of dropping the whole section) → README. ----
  const header = `项目根目录：${root.split(sep).pop() ?? root}（本地结构摘要，确定性生成）`;
  const out: string[] = [];
  let used = header.length + 2;
  const pushSection = (s: string): boolean => {
    const cost = s.length + 2; // + '\n\n' separator
    if (used + cost > MAX_CODE_DIGEST_CHARS) return false;
    out.push(s);
    used += cost;
    return true;
  };

  if (tree) {
    if (!pushSection(`【目录树】\n${tree}`)) truncated = true;
  }
  if (configStr) {
    if (!pushSection(configStr)) truncated = true;
  }
  if (infoLines.length) {
    const title = '【代码符号表】';
    let secUsed = used + title.length + 1;
    const kept: string[] = [];
    for (const line of infoLines) {
      if (secUsed + line.length + 1 > MAX_CODE_DIGEST_CHARS) break;
      kept.push(line);
      secUsed += line.length + 1;
    }
    if (kept.length) {
      out.push(`${title}\n${kept.join('\n')}`);
      used = secUsed;
    }
    if (kept.length < infoLines.length) truncated = true;
  }
  if (readmeStr) {
    if (!pushSection(readmeStr)) truncated = true;
  }

  const body = out.join('\n\n');
  const note = truncated ? `\n\n（超出 ${MAX_CODE_DIGEST_CHARS} 字符预算，后续部分已省略）` : '';
  return { digest: `${header}\n\n${body}${note}`.trim(), files: infoLines.length, truncated };
}
