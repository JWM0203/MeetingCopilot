/**
 * Live OpenAI-compatible LLM smoke using the production adapter.
 * Secrets are runtime-only; the script prints no response body or key.
 *
 * Required: MC_LLM_KEY
 * Optional: MC_LLM_URL (DeepSeek default), MC_LLM_MODEL (deepseek-chat default)
 */
import { chatOnce, chatStream, type ChatMessage } from '../electron/llm/adapter';

const apiKey = process.env.MC_LLM_KEY;
const baseUrl = process.env.MC_LLM_URL ?? 'https://api.deepseek.com/v1';
const model = process.env.MC_LLM_MODEL ?? 'deepseek-chat';

if (!apiKey) {
  console.error('LLM_SMOKE_FAIL: missing MC_LLM_KEY');
  process.exit(1);
}

const config = { apiKey, baseUrl, model };
const messages: ChatMessage[] = [
  { role: 'user', content: '只回答 CLOUD_OK，不要添加其他内容。' },
];

try {
  const once = await chatOnce(config, messages, { maxTokens: 16, temperature: 0 });
  let deltas = 0;
  const streamed = await chatStream(config, messages, {
    onDelta: () => {
      deltas++;
    },
  });
  if (!once.text.trim()) throw new Error('non-streaming response was empty');
  if (!streamed.text.trim()) throw new Error('streaming response was empty');
  if (deltas === 0) throw new Error('streaming response had no deltas');
  console.log(
    JSON.stringify({
      status: 'LLM_SMOKE_OK',
      model,
      onceChars: once.text.length,
      streamedChars: streamed.text.length,
      deltas,
      usage: once.usage ?? null,
    }),
  );
} catch (error) {
  console.error(`LLM_SMOKE_FAIL: ${(error as Error).message}`);
  process.exit(1);
}
