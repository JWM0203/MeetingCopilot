import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { chatOnce, chatStream, thinkingBody } from '../electron/llm/adapter';
import { isOfficialDeepSeek, migrateDeepSeekModel } from '../shared/deepseek';

const electron = vi.hoisted(() => ({ request: vi.fn(), setProxy: vi.fn().mockResolvedValue(undefined) }));
vi.mock('electron', () => ({
  net: { request: electron.request },
  session: { defaultSession: {}, fromPartition: () => ({ setProxy: electron.setProxy }) },
}));
import { extractVisionText, visionChat } from '../electron/llm/vision';
const config = { baseUrl: 'https://relay.example/v1', model: 'deepseek-flash', apiKey: 'not-a-real-key', timeoutMs: 50 };
const messages = [{ role: 'user' as const, content: 'hello' }];
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.clearAllMocks(); });

describe('official-only DeepSeek compatibility', () => {
  it('keeps custom relay identifiers and bodies unchanged', () => {
    expect(migrateDeepSeekModel(config.baseUrl, 'deepseek-chat')).toBe('deepseek-chat');
    expect(thinkingBody(config)).toEqual({});
    expect(thinkingBody({ ...config, thinking: false })).toEqual({ thinking: { type: 'disabled' } });
  });
  it('migrates retired official aliases without changing reasoning intent', () => {
    const baseUrl = 'https://api.deepseek.com/v1';
    expect(migrateDeepSeekModel(baseUrl, 'deepseek-chat')).toBe('deepseek-flash');
    expect(migrateDeepSeekModel(baseUrl, 'deepseek-reasoner')).toBe('deepseek-v4-flash');
    expect(thinkingBody({ ...config, baseUrl })).toEqual({ thinking: { type: 'disabled' } });
    expect(thinkingBody({ ...config, baseUrl, model: 'deepseek-v4-flash' })).toEqual({ thinking: { type: 'enabled' } });
  });
  it.each(['https://api.deepseek.com.evil/v1', 'https://evil/api.deepseek.com', 'http://api.deepseek.com', 'https://user@api.deepseek.com', 'bad url'])(
    'does not trust %s', (url) => expect(isOfficialDeepSeek(url)).toBe(false),
  );
});

describe('bounded text transport, without hidden retries', () => {
  it('sends the official fast-mode switch through both production request paths', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response('{"choices":[{"message":{"content":"ok"}}]}'))
      .mockResolvedValueOnce(new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n'));
    vi.stubGlobal('fetch', fetch);
    const official = { ...config, baseUrl: 'https://api.deepseek.com/v1' };
    await chatOnce(official, messages);
    await chatStream(official, messages, { onDelta() {} });
    for (const [, init] of fetch.mock.calls) {
      expect(JSON.parse(init.body).thinking).toEqual({ type: 'disabled' });
    }
  });
  it('bounds a stalled response body, not only the initial connection', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_url, init) => Promise.resolve(new Response(new ReadableStream({
      start(controller) { init.signal.addEventListener('abort', () => controller.error(init.signal.reason)); },
    })))));
    const result = expect(chatStream(config, messages, { onDelta() {} })).rejects.toMatchObject({ code: 'TIMEOUT' });
    await vi.advanceTimersByTimeAsync(51); await result;
  });
  it('surfaces in-band stream errors instead of marking a partial answer complete', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('data: {"choices":[{"delta":{"content":"partial"}}]}\n\ndata: {"error":{"message":"failed"}}\n\n'));
    vi.stubGlobal('fetch', fetch);
    await expect(chatStream(config, messages, { onDelta() {} })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('honors cancellation before sending or charging a request', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const controller = new AbortController(); controller.abort();
    await expect(chatStream(config, messages, { onDelta() {} }, controller.signal)).rejects.toMatchObject({ code: 'CANCELLED', name: 'AbortError' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('times out a stalled connection once with a typed error', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason));
    }));
    vi.stubGlobal('fetch', fetch);
    const result = expect(chatOnce(config, messages)).rejects.toMatchObject({ code: 'TIMEOUT', name: 'TimeoutError' });
    await vi.advanceTimersByTimeAsync(51); await result;
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('does not replay after a partial streamed answer fails', async () => {
    const stream = new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'));
    }, pull(controller) { controller.error(new Error('connection lost')); } });
    const fetch = vi.fn().mockResolvedValue(new Response(stream)); vi.stubGlobal('fetch', fetch);
    const onDelta = vi.fn();
    await expect(chatStream(config, messages, { onDelta })).rejects.toThrow('connection lost');
    expect(onDelta).toHaveBeenCalledWith('partial'); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('rejects non-string completion content', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"choices":[{"message":{"content":{}}}]}')));
    await expect(chatOnce(config, messages)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});

function request() {
  const req = Object.assign(new EventEmitter(), { setHeader: vi.fn(), write: vi.fn(), end: vi.fn(), abort: vi.fn() });
  electron.request.mockReturnValue(req);
  return req;
}
async function flush() { await Promise.resolve(); await Promise.resolve(); }

describe('screenshot transport', () => {
  it('returns a successful vision answer and sends the multimodal payload unchanged', async () => {
    const req = request();
    const imageMessages = [{ role: 'user' as const, content: [
      { type: 'image_url' as const, image_url: { url: 'data:image/png;base64,fixture' } },
      { type: 'text' as const, text: 'Explain this' },
    ] }];
    const pending = visionChat(config, imageMessages);
    await flush();
    const res = Object.assign(new EventEmitter(), { statusCode: 200 });
    req.emit('response', res);
    res.emit('data', Buffer.from(JSON.stringify({ choices: [{ message: { content: 'A chart' } }] })));
    res.emit('end');
    await expect(pending).resolves.toBe('A chart');
    expect(JSON.parse(req.write.mock.calls[0][0])).toEqual({ model: config.model, messages: imageMessages, stream: false });
    expect(req.abort).not.toHaveBeenCalled();
  });
  it('also bounds proxy initialization before an HTTP request exists', async () => {
    vi.useFakeTimers(); request();
    electron.setProxy.mockReturnValueOnce(new Promise(() => {}));
    const result = expect(visionChat({ ...config, proxyUrl: '127.0.0.1:9999' }, messages))
      .rejects.toMatchObject({ code: 'TIMEOUT' });
    await vi.advanceTimersByTimeAsync(51); await result;
    expect(electron.request).not.toHaveBeenCalled();
  });

  it.each(['not JSON', '{}', '{"choices":[{"message":{"content":{}}}]}', '{"choices":[{"message":{"reasoning_content":"thinking only"}}}]}'])(
    'rejects malformed or missing final vision text: %s', (body) => expect(() => extractVisionText(body)).toThrow(),
  );
  it('returns the final answer, not reasoning', () => {
    expect(extractVisionText('{"choices":[{"message":{"content":" answer ","reasoning_content":"private"}}]}')).toBe('answer');
  });
  it('settles cancellation even when Electron abort emits no error', async () => {
    const req = request(); const ac = new AbortController();
    const result = expect(visionChat(config, messages, ac.signal)).rejects.toMatchObject({ code: 'CANCELLED' });
    await flush(); ac.abort(); await result;
    expect(req.abort).toHaveBeenCalledTimes(1);
  });
  it('never sends a pre-cancelled screenshot', async () => {
    request(); const ac = new AbortController(); ac.abort();
    await expect(visionChat(config, messages, ac.signal)).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(electron.request).not.toHaveBeenCalled();
  });
  it('bounds stalled requests and aborts transport with no retries', async () => {
    vi.useFakeTimers(); const req = request();
    const result = expect(visionChat(config, messages)).rejects.toMatchObject({ code: 'TIMEOUT' });
    await vi.advanceTimersByTimeAsync(51); await result;
    expect(req.abort).toHaveBeenCalledTimes(1); expect(electron.request).toHaveBeenCalledTimes(1);
  });
  it('fails promptly when the response is interrupted', async () => {
    const req = request();
    const result = expect(visionChat(config, messages)).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    await flush(); const res = new EventEmitter(); req.emit('response', res); res.emit('aborted'); await result;
  });
  it('does not expose echoed screenshot or credential data in HTTP errors', async () => {
    const req = request(); const promise = visionChat(config, messages);
    const result = expect(promise).rejects.toMatchObject({ code: 'HTTP_ERROR', status: 401 });
    await flush(); const res = Object.assign(new EventEmitter(), { statusCode: 401 });
    req.emit('response', res); res.emit('data', Buffer.from('secret-image-and-key')); res.emit('end');
    await result; await expect(promise).rejects.not.toThrow('secret-image-and-key');
  });
});
