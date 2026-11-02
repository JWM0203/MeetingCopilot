/** Screenshot transport runs in the main process; a separate optional proxy
 * never changes the text provider's route. No automatic paid-request retries. */
import { net, session, type Session } from 'electron';
import { toProxyRules, type ChatMessage } from './adapter';
import { LlmRequestError, requestLifetime } from './request';

export function extractVisionText(jsonBody: string): string {
  let value: unknown;
  try { value = JSON.parse(jsonBody); }
  catch { throw new LlmRequestError('INVALID_RESPONSE', 'Vision provider returned invalid JSON'); }
  const content = (value as { choices?: { message?: { content?: unknown } }[] } | null)
    ?.choices?.[0]?.message?.content;
  // Reasoning-only output is not a completed answer. Do not display it as one.
  if (typeof content !== 'string' || !content.trim()) {
    throw new LlmRequestError('INVALID_RESPONSE', 'Vision provider returned no answer text; check model image support');
  }
  return content.trim();
}

export interface VisionConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
  proxyUrl?: string;
  timeoutMs?: number;
}

// Separate sessions by route: concurrent requests cannot overwrite each other's proxy.
const proxiedSessions = new Map<string, Promise<Session>>();
let nextProxySessionId = 0;
function pickSession(rules: string): Promise<Session> {
  if (!rules) return Promise.resolve(session.defaultSession);
  let pending = proxiedSessions.get(rules);
  if (!pending) {
    const ses = session.fromPartition(`vision-proxy-${nextProxySessionId++}`);
    pending = ses.setProxy({ proxyRules: rules }).then(() => ses);
    proxiedSessions.set(rules, pending);
    pending.catch(() => proxiedSessions.delete(rules));
  }
  return pending;
}

export async function visionChat(
  config: VisionConfig,
  messages: ChatMessage[],
  signal?: AbortSignal,
): Promise<string> {
  const lifetime = requestLifetime(signal, config.timeoutMs);
  try {
    lifetime.signal.throwIfAborted();
    const raw = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      let req: ReturnType<typeof net.request> | undefined;
      let settled = false;
      const finish = (error?: unknown, result?: { status: number; body: string }) => {
        if (settled) return;
        settled = true;
        lifetime.signal.removeEventListener('abort', onAbort);
        if (error) reject(error);
        else resolve(result!);
      };
      const onAbort = () => {
        finish(lifetime.signal.reason);
        req?.abort();
      };
      lifetime.signal.addEventListener('abort', onAbort, { once: true });
      // Keep proxy setup within the same cancellable deadline as the request.
      void pickSession(toProxyRules(config.proxyUrl)).then((ses) => {
        if (settled) return;
        req = net.request({ method: 'POST', url: `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`, session: ses });
        req.setHeader('Content-Type', 'application/json');
        req.setHeader('Authorization', `Bearer ${config.apiKey}`);
        req.on('response', (res) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk.toString('utf8'); });
          res.on('error', () => finish(new LlmRequestError('NETWORK_ERROR', 'Vision response connection failed')));
          res.on('aborted', () => finish(new LlmRequestError('NETWORK_ERROR', 'Vision response was interrupted')));
          res.on('end', () => finish(undefined, { status: res.statusCode ?? 0, body: data }));
        });
        req.on('error', () => finish(new LlmRequestError('NETWORK_ERROR', 'Vision connection failed; check network and proxy settings')));
        req.on('abort', () => finish(new LlmRequestError('CANCELLED', 'Vision request cancelled')));
        req.write(JSON.stringify({ model: config.model, messages, stream: false }));
        req.end();
      }).catch((error) => finish(error));
    });
    if (raw.status < 200 || raw.status >= 300) {
      // Raw provider bodies may echo image data, prompts or credentials.
      throw new LlmRequestError('HTTP_ERROR', `Vision HTTP ${raw.status}; check model image support and account access`, raw.status);
    }
    return extractVisionText(raw.body);
  } finally { lifetime.dispose(); }
}
