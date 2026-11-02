import { describe, expect, it, vi } from 'vitest';
import { retrieveForAnswer } from '../electron/ragAnswer';
import { buildAnswerMessages, buildVisionMessages } from '../electron/llm/prompts';
import { RAG_CONTEXT_CHAR_BUDGET } from '../shared/rag';
const base = { mode: 'free' as const, freeQuestion: 'What changed?', recentTranscript: [] };
describe('opt-in retrieval answer integration', () => {
  it('disabled, translation and empty questions never invoke retrieval', async () => {
    const host = { query: vi.fn() };
    for (const over of [{ enabled: false }, { scope: { enabled: false } }, { mode: 'translate' as const }, { question: ' ' }]) {
      expect((await retrieveForAnswer({ host, enabled: true, scope: { enabled: true }, mode: 'free', question: 'Q', recentTranscript: [], ...over })).context).toBe('');
    }
    expect(host.query).not.toHaveBeenCalled();
  });
  it('retrieval failure produces byte-identical legacy messages', async () => {
    const result = await retrieveForAnswer({ host: { query: vi.fn().mockRejectedValue(new Error('offline')) }, enabled: true, scope: { enabled: true }, mode: 'free', question: 'Q', recentTranscript: [] });
    expect(buildAnswerMessages({ ...base, retrievedContext: result.context })).toEqual(buildAnswerMessages(base));
    expect(buildVisionMessages('Q', 'data:image/png;base64,a', undefined, '')).toEqual(buildVisionMessages('Q', 'data:image/png;base64,a'));
  });
  it('passes selected scope and only three recent lines, and bounds injected references', async () => {
    const host = { query: vi.fn().mockResolvedValue({ context: 'x'.repeat(10000), sources: [], durationMs: 1 }) };
    const scope = { enabled: true, includePaths: ['project'] };
    const result = await retrieveForAnswer({ host, enabled: true, scope, mode: 'free', question: ' Q ', recentTranscript: ['old', 'one', 'two', 'three'] });
    expect(host.query).toHaveBeenCalledWith({ requestId: undefined, query: 'Q\none\ntwo\nthree', scope });
    const messages = buildAnswerMessages({ ...base, retrievedContext: result.context });
    expect(JSON.stringify(messages)).not.toContain('x'.repeat(RAG_CONTEXT_CHAR_BUDGET + 1));
    expect(JSON.stringify(messages)).toContain('不可信参考资料');
  });
  it('translation ignores references even when callers accidentally supply them', () => {
    const input = { ...base, mode: 'translate' as const, question: 'hello' };
    expect(buildAnswerMessages({ ...input, retrievedContext: 'secret unrelated snippet' })).toEqual(buildAnswerMessages(input));
  });
});
