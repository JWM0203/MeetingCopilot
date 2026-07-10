/**
 * SDD contract: OpenAI-compatible chat adapter (PLAN §7.1).
 * DeepSeek / GPT / Qwen / Gemini-openai all satisfy this one interface.
 * Runs in the MAIN process only — the API key never reaches the renderer.
 */

export interface LlmConfig {
  baseUrl: string; // e.g. https://api.deepseek.com/v1
  model: string;
  apiKey: string;
}

export type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  /** plain text, or multimodal parts (vision models, R5) */
  content: string | ChatContentPart[];
}

export interface ChatStreamCallbacks {
  onDelta(text: string): void;
}

export interface ChatResult {
  text: string;
  /** DeepSeek streams usage (incl. cache counters) in the final SSE chunk */
  usage?: ChatUsage;
}

/**
 * Incremental SSE parser (pure logic, unit-tested): feed raw chunks, get
 * complete `data:` payloads. Handles payloads split across chunks, CRLF,
 * multiple events per chunk, and the [DONE] sentinel.
 */
export class SseParser {
  private buf = '';
  done = false;

  push(chunk: string): string[] {
    if (this.done) return [];
    this.buf += chunk;
    const out: string[] = [];
    let idx: number;
    while ((idx = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, idx).replace(/\r$/, '').trimEnd();
      this.buf = this.buf.slice(idx + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') {
        this.done = true;
        return out;
      }
      if (payload) out.push(payload);
    }
    return out;
  }
}

/** Extract the streamed content delta from one OpenAI-compatible SSE payload. */
export function extractDelta(payload: string): string {
  try {
    const j = JSON.parse(payload);
    return j?.choices?.[0]?.delta?.content ?? j?.choices?.[0]?.message?.content ?? '';
  } catch {
    return '';
  }
}

/** Extract the full message content from a non-streamed OpenAI-compatible reply. */
export function extractMessageText(jsonBody: string): string {
  try {
    const j = JSON.parse(jsonBody);
    return j?.choices?.[0]?.message?.content ?? '';
  } catch {
    return '';
  }
}

/**
 * Normalize a proxy string ('127.0.0.1:7897' or 'http://127.0.0.1:7897') into
 * Electron setProxy proxyRules covering both schemes. Empty -> '' (direct).
 */
export function toProxyRules(proxy: string | undefined): string {
  const p = (proxy ?? '').trim().replace(/^\w+:\/\//, '').replace(/\/+$/, '');
  if (!p) return '';
  return `http=${p};https=${p}`;
}

/** token accounting of a non-streamed reply (DeepSeek adds cache counters) */
export interface ChatUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  /** DeepSeek prefix-cache counters — the prewarm acceptance signal */
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
}

/**
 * One-shot NON-streaming chat completion, returning text + usage. Used off
 * the critical path: prefix-cache prewarm (max_tokens=1) and memo updates.
 */
export async function chatOnce(
  config: LlmConfig,
  messages: ChatMessage[],
  opts?: { maxTokens?: number; temperature?: number; signal?: AbortSignal },
): Promise<{ text: string; usage?: ChatUsage }> {
  const url = `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      stream: false,
      temperature: opts?.temperature ?? 0.5,
      ...(opts?.maxTokens ? { max_tokens: opts.maxTokens } : {}),
    }),
    signal: opts?.signal,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`LLM HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  const j = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: ChatUsage;
  };
  return { text: j?.choices?.[0]?.message?.content ?? '', usage: j?.usage };
}

/**
 * Streaming chat completion. Resolves with the full text; deltas arrive via
 * callbacks. Abort via the signal.
 */
export async function chatStream(
  config: LlmConfig,
  messages: ChatMessage[],
  callbacks: ChatStreamCallbacks,
  signal?: AbortSignal,
): Promise<ChatResult> {
  const url = `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      stream: true,
      temperature: 0.5,
    }),
    signal,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`LLM HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  if (!res.body) throw new Error('LLM response has no body');

  const parser = new SseParser();
  const decoder = new TextDecoder();
  let full = '';
  let usage: ChatUsage | undefined;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const payload of parser.push(decoder.decode(value, { stream: true }))) {
      const delta = extractDelta(payload);
      if (delta) {
        full += delta;
        callbacks.onDelta(delta);
      }
      const u = extractUsage(payload);
      if (u) usage = u;
    }
    if (parser.done) break;
  }
  return { text: full, usage };
}

/** Pull the usage object from an SSE payload if present (DeepSeek final chunk). */
export function extractUsage(payload: string): ChatUsage | undefined {
  try {
    const j = JSON.parse(payload);
    return j?.usage ?? undefined;
  } catch {
    return undefined;
  }
}
