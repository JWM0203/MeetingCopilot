import { describe, expect, it } from 'vitest';
import type { RagChunk } from '../shared/rag';
import { denseSearch, fuseAndPack, lexicalSearch } from '../electron/rag/retrieval';

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function runSyntheticRetrievalBenchmark(input: {
  chunks: number;
  dimensions: number;
  queries: number;
  seed: number;
}): number[] {
  const random = seeded(input.seed);
  const chunks: RagChunk[] = Array.from({ length: input.chunks }, (_, index) => ({
    id: `chunk-${index}`,
    documentId: `doc-${Math.floor(index / 8)}`,
    relativePath: `projects/project-${Math.floor(index / 8)}/note-${index}.md`,
    title: `Note ${index}`,
    text: `支付系统 interview knowledge chunk ${index}`,
    ordinal: index % 8,
    hash: `hash-${index}`,
  }));
  const matrix = new Float32Array(input.chunks * input.dimensions);
  for (let index = 0; index < matrix.length; index++) matrix[index] = random() * 2 - 1;
  const query = new Float32Array(input.dimensions);
  for (let index = 0; index < query.length; index++) query[index] = random() * 2 - 1;

  const search = () => {
    const lexical = lexicalSearch('支付系统 P95 latency', chunks, 24);
    const dense = denseSearch(query, matrix, chunks, 24);
    fuseAndPack({ lexical, dense, scope: { enabled: true } });
  };
  search();
  const timings: number[] = [];
  for (let index = 0; index < input.queries; index++) {
    query[index % query.length] *= -1;
    const started = performance.now();
    search();
    timings.push(performance.now() - started);
  }
  return timings;
}

describe('warm RAG retrieval performance', () => {
  it(
    'searches a 20k-chunk, 384-dimensional matrix within the 250 ms budget',
    () => {
      const timings = runSyntheticRetrievalBenchmark({
        chunks: 20_000,
        dimensions: 384,
        queries: 100,
        seed: 42,
      });
      expect(percentile(timings, 0.95)).toBeLessThanOrEqual(250);
    },
    30_000,
  );
});
