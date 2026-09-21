import { basename } from 'path';
import {
  RAG_CONTEXT_CHAR_BUDGET,
  type RagChunk,
  type RagScope,
  type RetrievedChunk,
} from '../../shared/rag';

export interface RankedCandidate {
  chunk: RagChunk;
  score: number;
}

function terms(text: string): string[] {
  const normalized = text.normalize('NFKC').toLowerCase();
  const latin = normalized.match(/[a-z0-9][a-z0-9_.+#/-]*/g) ?? [];
  const cjkRuns = normalized.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+/gu) ?? [];
  const cjk: string[] = [];
  for (const run of cjkRuns) {
    if (run.length === 1) cjk.push(run);
    else for (let i = 0; i < run.length - 1; i++) cjk.push(run.slice(i, i + 2));
  }
  return [...latin, ...cjk];
}

export function lexicalSearch(
  query: string,
  chunks: readonly RagChunk[],
  limit: number,
): RankedCandidate[] {
  const queryTerms = terms(query);
  if (!queryTerms.length || limit <= 0) return [];
  const wanted = new Map<string, number>();
  for (const term of queryTerms) wanted.set(term, (wanted.get(term) ?? 0) + 1);

  return chunks
    .map((chunk) => {
      const seen = new Map<string, number>();
      for (const term of terms(`${chunk.relativePath} ${chunk.text}`)) {
        seen.set(term, (seen.get(term) ?? 0) + 1);
      }
      let score = 0;
      for (const [term, queryCount] of wanted) {
        const count = seen.get(term) ?? 0;
        if (count) score += Math.min(queryCount, count) * (term.length > 2 ? 2 : 1);
      }
      return { chunk, score };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score || a.chunk.id.localeCompare(b.chunk.id))
    .slice(0, limit);
}

export function denseSearch(
  query: Float32Array,
  matrix: Float32Array,
  chunks: readonly RagChunk[],
  limit: number,
): RankedCandidate[] {
  if (!chunks.length || !query.length || limit <= 0) return [];
  if (matrix.length !== chunks.length * query.length) {
    throw new Error('RAG vector matrix dimensions do not match chunks');
  }
  const ranked: RankedCandidate[] = [];
  for (let row = 0; row < chunks.length; row++) {
    let score = 0;
    const offset = row * query.length;
    for (let col = 0; col < query.length; col++) score += query[col] * matrix[offset + col];
    ranked.push({ chunk: chunks[row], score });
  }
  return ranked
    .sort((a, b) => b.score - a.score || a.chunk.id.localeCompare(b.chunk.id))
    .slice(0, limit);
}

function normalizedPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
}

function inScope(chunk: RagChunk, scope: RagScope): boolean {
  if (!scope.enabled) return false;
  const selected = scope.includePaths?.map(normalizedPath).filter(Boolean) ?? [];
  if (!selected.length) return true;
  const path = normalizedPath(chunk.relativePath);
  return selected.some((entry) => path === entry || path.startsWith(`${entry}/`));
}

function similarity(a: string, b: string): number {
  const left = new Set(terms(a));
  const right = new Set(terms(b));
  if (!left.size || !right.size) return a === b ? 1 : 0;
  let intersection = 0;
  for (const term of left) if (right.has(term)) intersection++;
  return intersection / (left.size + right.size - intersection);
}

export function fuseAndPack(input: {
  lexical: readonly RankedCandidate[];
  dense: readonly RankedCandidate[];
  scope: RagScope;
  charBudget?: number;
}): { results: RetrievedChunk[]; context: string } {
  if (!input.scope.enabled) return { results: [], context: '' };
  const fused = new Map<string, RetrievedChunk>();
  const add = (items: readonly RankedCandidate[]) => {
    items.forEach((candidate, rank) => {
      if (!inScope(candidate.chunk, input.scope)) return;
      const current = fused.get(candidate.chunk.id);
      const contribution = 1 / (60 + rank + 1);
      fused.set(candidate.chunk.id, {
        chunk: candidate.chunk,
        score: (current?.score ?? 0) + contribution,
      });
    });
  };
  add(input.lexical);
  add(input.dense);

  const selected: RetrievedChunk[] = [];
  const perDocument = new Map<string, number>();
  for (const candidate of [...fused.values()].sort(
    (a, b) => b.score - a.score || a.chunk.id.localeCompare(b.chunk.id),
  )) {
    if ((perDocument.get(candidate.chunk.documentId) ?? 0) >= 2) continue;
    if (selected.some((item) => similarity(item.chunk.text, candidate.chunk.text) >= 0.85)) continue;
    selected.push(candidate);
    perDocument.set(candidate.chunk.documentId, (perDocument.get(candidate.chunk.documentId) ?? 0) + 1);
    if (selected.length >= 6) break;
  }

  const budget = Math.max(0, input.charBudget ?? RAG_CONTEXT_CHAR_BUDGET);
  const packed: RetrievedChunk[] = [];
  let context = '';
  for (const result of selected) {
    const block = `【来源：${result.chunk.relativePath}】\n${result.chunk.text}`;
    const separator = context ? '\n\n' : '';
    const remaining = budget - context.length - separator.length;
    if (remaining <= 0) break;
    const clipped = block.slice(0, remaining);
    if (!clipped) break;
    context += separator + clipped;
    packed.push(result);
    if (clipped.length < block.length) break;
  }

  return { results: packed, context };
}

export function sourceName(chunk: RagChunk): string {
  return basename(chunk.relativePath.replace(/\\/g, '/'));
}
