/**
 * Vision (R5) transport — MAIN PROCESS ONLY (imports electron).
 *
 * DeepSeek has no image input (verified: official API rejects image_url on
 * all models), so screenshot Q&A needs a separate vision provider. Gemini is
 * multimodal but blocked in China, so this path routes through a proxied
 * Electron session (net.request) while the latency-critical DeepSeek answer
 * path stays on direct global fetch. Non-streaming: on-demand + proxy latency
 * dominates, so one round-trip is simpler and robust.
 */
import { net, session, type Session } from 'electron';
import { toProxyRules, type ChatMessage } from './adapter';

/** message.content, falling back to reasoning_content (MiMo/thinking models). */
function extractVisionText(jsonBody: string): string {
  try {
    const j = JSON.parse(jsonBody);
    const m = j?.choices?.[0]?.message ?? {};
    return (m.content ?? '').trim() || (m.reasoning_content ?? '').trim();
  } catch {
    return '';
  }
}

export interface VisionConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
  /** e.g. '127.0.0.1:7897'; empty => direct */
  proxyUrl?: string;
}

let proxiedSession: Session | null = null;

/**
 * Direct calls (MiMo etc.) use the proven defaultSession. Only when a proxy is
 * configured (Gemini) do we use a dedicated partitioned session with proxy
 * rules — keeping the proxy off every other network call.
 */
async function pickSession(rules: string): Promise<Session> {
  if (!rules) return session.defaultSession;
  if (!proxiedSession) proxiedSession = session.fromPartition('vision-proxy');
  await proxiedSession.setProxy({ proxyRules: rules });
  return proxiedSession;
}

export async function visionChat(
  config: VisionConfig,
  messages: ChatMessage[],
  signal?: AbortSignal,
): Promise<string> {
  const url = `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const body = JSON.stringify({ model: config.model, messages, stream: false });
  const rules = toProxyRules(config.proxyUrl);
  const ses = await pickSession(rules);

  const raw = await new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = net.request({ method: 'POST', url, session: ses });
    req.setHeader('Content-Type', 'application/json');
    req.setHeader('Authorization', `Bearer ${config.apiKey}`);
    const onAbort = () => req.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    req.on('response', (res) => {
      let data = '';
      res.on('data', (c) => (data += c.toString('utf8')));
      res.on('end', () => {
        signal?.removeEventListener('abort', onAbort);
        resolve({ status: res.statusCode ?? 0, body: data });
      });
    });
    req.on('error', (e) => {
      signal?.removeEventListener('abort', onAbort);
      reject(e);
    });
    req.write(body);
    req.end();
  });

  if (raw.status < 200 || raw.status >= 300) {
    throw new Error(`Vision HTTP ${raw.status}: ${raw.body.slice(0, 300)}`);
  }
  const text = extractVisionText(raw.body);
  if (!text) throw new Error(`视觉模型返回空结果：${raw.body.slice(0, 200)}`);
  return text;
}
