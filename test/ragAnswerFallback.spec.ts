import { describe, expect, it, vi } from 'vitest';
import { retrieveForAnswer } from '../electron/ragAnswer';
import type { RagQueryResult } from '../shared/rag';

const FOUND: RagQueryResult = {
  context: 'grounded',
  sources: [],
  durationMs: 12,
};

describe('retrieveForAnswer', () => {
  it.each([
    { enabled: false, mode: 'segment' as const, question: 'question' },
    { enabled: true, mode: 'translate' as const, question: 'question' },
    { enabled: true, mode: 'segment' as const, question: '   ' },
  ])('does not query for disabled, translation, or empty-question input', async (input) => {
    const query = vi.fn().mockResolvedValue(FOUND);
    const result = await retrieveForAnswer({
      host: { query },
      scope: { enabled: true },
      recentTranscript: [],
      ...input,
    });
    expect(query).not.toHaveBeenCalled();
    expect(result.context).toBe('');
    expect(result.sources).toEqual([]);
  });

  it('falls back to an empty result when retrieval throws', async () => {
    const result = await retrieveForAnswer({
      host: { query: vi.fn().mockRejectedValue(new Error('worker unavailable')) },
      enabled: true,
      scope: { enabled: true },
      mode: 'segment',
      question: 'question',
      recentTranscript: [],
    });
    expect(result.context).toBe('');
    expect(result.sources).toEqual([]);
    expect(result.fallback).toBe('error');
  });

  it('queries with the question, only three latest transcript lines, scope, and request id', async () => {
    const query = vi.fn().mockResolvedValue(FOUND);
    const result = await retrieveForAnswer({
      host: { query },
      requestId: 'llm-42',
      enabled: true,
      scope: { enabled: true, includePaths: ['projects'] },
      mode: 'free',
      question: 'current question',
      recentTranscript: ['old', 'one', 'two', 'three'],
    });
    expect(result).toBe(FOUND);
    expect(query).toHaveBeenCalledWith({
      requestId: 'llm-42',
      query: 'current question\none\ntwo\nthree',
      scope: { enabled: true, includePaths: ['projects'] },
    });
  });
});
