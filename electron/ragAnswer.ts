import type { LlmAskPayload } from '../shared/protocol';
import type { RagQueryInput, RagQueryResult, RagScope } from '../shared/rag';

const EMPTY_RESULT: RagQueryResult = {
  context: '',
  sources: [],
  durationMs: 0,
  fallback: 'unavailable',
};

export async function retrieveForAnswer(input: {
  host: { query(request: RagQueryInput): Promise<RagQueryResult> };
  requestId?: string;
  enabled: boolean;
  scope?: RagScope;
  mode: LlmAskPayload['mode'];
  question: string;
  recentTranscript: string[];
}): Promise<RagQueryResult> {
  const question = input.question.trim();
  if (!input.enabled || input.mode === 'translate' || !question || !input.scope?.enabled) {
    return { ...EMPTY_RESULT, sources: [] };
  }

  const transcript = input.recentTranscript
    .slice(-3)
    .map((line) => line.trim())
    .filter(Boolean);
  try {
    return await input.host.query({
      requestId: input.requestId,
      query: [question, ...transcript].join('\n'),
      scope: input.scope,
    });
  } catch {
    return { context: '', sources: [], durationMs: 0, fallback: 'error' };
  }
}
