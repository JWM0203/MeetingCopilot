import { describe, expect, it } from 'vitest';
import type { RagChunk } from '../shared/rag';
import { denseSearch, fuseAndPack, lexicalSearch } from '../electron/rag/retrieval';

function chunk(
  id: string,
  relativePath: string,
  text: string,
  documentId = relativePath,
): RagChunk {
  return {
    id,
    documentId,
    relativePath,
    title: relativePath.split('/').at(-1) ?? relativePath,
    text,
    ordinal: 0,
    hash: id,
  };
}

describe('RAG hybrid retrieval', () => {
  const chunks = [
    chunk('payments', 'projects/payments/design.md', 'React 并发渲染面板，支付接口使用幂等键避免重复扣款，P95 为 120ms。'),
    chunk('search', 'projects/search/notes.md', '向量搜索使用余弦相似度和批量推理。'),
    chunk('career', 'career/story.md', '我负责跨团队沟通并推动项目按期上线。'),
  ];

  it('matches Chinese terms, Latin identifiers, and exact numbers', () => {
    const results = lexicalSearch('React 重复扣款 P95 120ms', chunks, 3);
    expect(results[0].chunk.id).toBe('payments');
    expect(results[0].score).toBeGreaterThan(0);
  });

  it('ranks normalized vectors by dot product', () => {
    const matrix = new Float32Array([
      1, 0,
      0.2, 0.8,
      -1, 0,
    ]);
    const results = denseSearch(new Float32Array([1, 0]), matrix, chunks, 2);
    expect(results.map((result) => result.chunk.id)).toEqual(['payments', 'search']);
  });

  it('combines semantic and exact matches and respects the context budget', () => {
    const lexical = lexicalSearch('React 并发渲染 P95', chunks, 10);
    const dense = denseSearch(
      new Float32Array([1, 0]),
      new Float32Array([1, 0, 0, 1, -1, 0]),
      chunks,
      10,
    );
    const packed = fuseAndPack({
      lexical,
      dense,
      scope: { enabled: true },
      charBudget: 160,
    });

    expect(packed.results[0].chunk.id).toBe('payments');
    expect(packed.context).toContain('payments/design.md');
    expect(packed.context.length).toBeLessThanOrEqual(160);
  });

  it('limits results to selected folders', () => {
    const candidates = chunks.map((item, index) => ({ chunk: item, score: 10 - index }));
    const packed = fuseAndPack({
      lexical: candidates,
      dense: [],
      scope: { enabled: true, includePaths: ['projects/payments'] },
    });

    expect(packed.results.map((result) => result.chunk.id)).toEqual(['payments']);
  });

  it('returns nothing for a disabled scope', () => {
    const packed = fuseAndPack({
      lexical: [{ chunk: chunks[0], score: 1 }],
      dense: [],
      scope: { enabled: false },
    });
    expect(packed).toEqual({ results: [], context: '' });
  });

  it('caps near-duplicates and excessive results from one document', () => {
    const repeated = [
      chunk('a1', 'a.md', '支付系统使用幂等键避免重复扣款。', 'a'),
      { ...chunk('a2', 'a.md', '支付系统使用幂等键，避免重复扣款。', 'a'), ordinal: 1 },
      { ...chunk('a3', 'a.md', '支付系统支持退款和对账。', 'a'), ordinal: 2 },
      chunk('b1', 'b.md', '订单服务记录支付状态。', 'b'),
    ];
    const ranked = repeated.map((item, index) => ({ chunk: item, score: 10 - index }));
    const packed = fuseAndPack({ lexical: ranked, dense: [], scope: { enabled: true } });

    expect(packed.results.filter((result) => result.chunk.documentId === 'a')).toHaveLength(2);
    expect(packed.results.some((result) => result.chunk.id === 'b1')).toBe(true);
  });
});
