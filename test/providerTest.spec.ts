import { afterEach, beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';
import type { AddressInfo } from 'net';
import { readFileSync } from 'fs';
import { join } from 'path';
import { WebSocketServer, type WebSocket as WsSocket } from 'ws';
import {
  resolveTestApiKey,
  runProviderTest,
  runSingleKeyPlanTest,
  withoutCandidateKey,
  type ProviderTestDeps,
} from '../electron/providerTest';
import type { ProviderSlot } from '../shared/protocol';
import { chatOnce } from '../electron/llm/adapter';
import { AliyunRealtimeEngine } from '../electron/asr/aliyunRealtimeEngine';
import { CloudAsrEngine } from '../electron/asr/cloudEngine';
import { decodeWav16kMono } from '../electron/asr/wavRead';
import type { ProviderTestRequest } from '../shared/protocol';

// the REAL bundled fixture, so a broken/renamed clip fails the suite
const FIXTURE_ZH = readFileSync(join(__dirname, '..', 'resources', 'test-audio', 'asr-test-zh.wav'));
const FIXTURE_EN = readFileSync(join(__dirname, '..', 'resources', 'test-audio', 'asr-test-en.wav'));
const PCM_ZH = decodeWav16kMono(FIXTURE_ZH);

function deps(over: Partial<ProviderTestDeps> = {}): ProviderTestDeps {
  return {
    chatOnce,
    visionChat: async () => 'ok',
    loadRealtimeEngine: (cfg) => AliyunRealtimeEngine.load(cfg),
    loadSegmentEngine: (cfg) => CloudAsrEngine.load(cfg),
    readTestAudio: () => PCM_ZH,
    readTestImage: () => 'data:image/png;base64,AAAA',
    timeoutMs: 5_000,
    now: () => Date.now(),
    ...over,
  };
}

// ------------------------------------------------------------ key handling

describe('resolveTestApiKey', () => {
  const stored: Partial<Record<ProviderSlot, string>> = {
    llm: 'sk-stored-llm',
    'asr-realtime': 'sk-stored-rt',
  };
  const lookup = (slot: ProviderSlot) => stored[slot];

  const base: ProviderTestRequest = {
    capability: 'text-llm',
    providerId: 'deepseek',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    slot: 'llm',
  };

  it('prefers the key the user just typed over the saved one', () => {
    expect(
      resolveTestApiKey({ ...base, candidateApiKey: 'sk-typed', useStoredKey: true }, lookup),
    ).toBe('sk-typed');
  });

  it('trims a pasted key (clipboards add whitespace)', () => {
    expect(resolveTestApiKey({ ...base, candidateApiKey: '  sk-typed\n' }, lookup)).toBe('sk-typed');
  });

  it('falls back to the stored key only when explicitly asked, and only for the named slot', () => {
    expect(resolveTestApiKey({ ...base, useStoredKey: true }, lookup)).toBe('sk-stored-llm');
    expect(
      resolveTestApiKey({ ...base, slot: 'asr-realtime', useStoredKey: true }, lookup),
    ).toBe('sk-stored-rt');
    // an empty slot stays empty rather than borrowing another slot's key
    expect(resolveTestApiKey({ ...base, slot: 'vision', useStoredKey: true }, lookup)).toBe('');
  });

  it('never guesses: no candidate and no explicit request means no key', () => {
    expect(resolveTestApiKey(base, lookup)).toBe('');
    expect(resolveTestApiKey({ ...base, candidateApiKey: '   ' }, lookup)).toBe('');
    expect(resolveTestApiKey({ ...base, slot: undefined, useStoredKey: true }, lookup)).toBe('');
  });

  it('withoutCandidateKey strips the plaintext and keeps everything else', () => {
    const req: ProviderTestRequest = {
      ...base,
      presetId: 'deepseek.text.fast',
      candidateApiKey: 'sk-typed-secret',
      useStoredKey: false,
      proxyUrl: '127.0.0.1:7897',
      language: 'chinese',
    };
    const stripped = withoutCandidateKey(req);
    expect(stripped).not.toHaveProperty('candidateApiKey');
    expect(JSON.stringify(stripped)).not.toContain('sk-typed-secret');
    expect(stripped).toMatchObject({
      presetId: 'deepseek.text.fast',
      capability: 'text-llm',
      providerId: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
      slot: 'llm',
      useStoredKey: false,
      proxyUrl: '127.0.0.1:7897',
      language: 'chinese',
    });
    // the caller's object is left alone
    expect(req.candidateApiKey).toBe('sk-typed-secret');
  });
});

// ---------------------------------------------------------------- HTTP mock

interface HttpCapture {
  url?: string;
  auth?: string;
  body?: Record<string, unknown>;
}

type HttpBehavior =
  | { kind: 'ok'; content?: string }
  | { kind: 'status'; status: number; body: string }
  | { kind: 'hang' };

describe('runProviderTest — HTTP-backed capabilities', () => {
  let server: Server;
  let baseUrl: string;
  let captured: HttpCapture = {};
  let requests = 0;
  let behavior: HttpBehavior = { kind: 'ok' };

  beforeAll(async () => {
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        requests += 1;
        captured = {
          url: req.url,
          auth: req.headers.authorization,
          body: JSON.parse(raw || '{}'),
        };
        if (behavior.kind === 'hang') return; // never answer: exercise the budget
        if (behavior.kind === 'status') {
          res.writeHead(behavior.status, { 'Content-Type': 'application/json' });
          res.end(behavior.body);
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { content: behavior.content ?? '' } }] }));
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  });

  afterAll(() => {
    server.closeAllConnections?.();
    server.close();
  });

  beforeEach(() => {
    behavior = { kind: 'ok' };
    captured = {};
    requests = 0;
  });

  const llmReq = (): ProviderTestRequest => ({
    capability: 'text-llm',
    providerId: 'deepseek',
    baseUrl,
    model: 'deepseek-chat',
    slot: 'llm',
  });

  const segReq = (): ProviderTestRequest => ({
    capability: 'asr-segment',
    providerId: 'mimo',
    baseUrl,
    model: 'mimo-v2.5-asr',
    slot: 'asr-cloud',
  });

  // ---- text LLM ----

  it('text-llm: a 200 reply is a pass and the probe stays minimal', async () => {
    const r = await runProviderTest(llmReq(), 'sk-live-1234', deps());
    expect(r.ok).toBe(true);
    expect(r.code).toBe('OK');
    expect(r.retryable).toBe(false);
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
    expect(captured.url).toBe('/v1/chat/completions');
    expect(captured.auth).toBe('Bearer sk-live-1234');
    expect(captured.body).toMatchObject({
      model: 'deepseek-chat',
      max_tokens: 1,
      temperature: 0,
      stream: false,
      messages: [{ role: 'user', content: 'ping' }],
    });
  });

  it('text-llm: an empty completion still counts as a pass', async () => {
    behavior = { kind: 'ok', content: '' };
    expect((await runProviderTest(llmReq(), 'sk-live-1234', deps())).ok).toBe(true);
  });

  it('text-llm: 401 maps to INVALID_KEY', async () => {
    behavior = { kind: 'status', status: 401, body: '{"error":{"message":"Authentication Fails"}}' };
    const r = await runProviderTest(llmReq(), 'sk-bad-1234', deps());
    expect(r).toMatchObject({ ok: false, code: 'INVALID_KEY', retryable: false });
    expect(r.messageZh).toContain('API Key');
  });

  it('text-llm: 429 maps to RATE_LIMITED and is retryable', async () => {
    behavior = { kind: 'status', status: 429, body: '{"error":{"message":"rate limit"}}' };
    expect(await runProviderTest(llmReq(), 'sk-live-1234', deps())).toMatchObject({
      ok: false,
      code: 'RATE_LIMITED',
      retryable: true,
    });
  });

  it('text-llm: a model the provider does not know maps to MODEL_NOT_FOUND', async () => {
    behavior = { kind: 'status', status: 404, body: '{"error":{"message":"Model Not Exist"}}' };
    expect(await runProviderTest(llmReq(), 'sk-live-1234', deps())).toMatchObject({
      ok: false,
      code: 'MODEL_NOT_FOUND',
    });
  });

  it('text-llm: a server that never answers is cut off at the budget', async () => {
    behavior = { kind: 'hang' };
    const r = await runProviderTest(llmReq(), 'sk-live-1234', deps({ timeoutMs: 150 }));
    expect(r).toMatchObject({ ok: false, code: 'TIMEOUT', retryable: true });
    expect(r.latencyMs).toBeLessThan(3_000);
  });

  it('never lets the key leak into the result, even when the provider echoes it', async () => {
    behavior = {
      kind: 'status',
      status: 401,
      body: '{"error":{"message":"bad Authorization: Bearer sk-supersecret9876"}}',
    };
    const r = await runProviderTest(llmReq(), 'sk-supersecret9876', deps());
    expect(JSON.stringify(r)).not.toContain('supersecret9876');
    expect(r.code).toBe('INVALID_KEY');
  });

  it('refuses to spend a request when there is no key at all', async () => {
    const r = await runProviderTest(llmReq(), '', deps());
    expect(r).toMatchObject({ ok: false, code: 'INVALID_KEY', latencyMs: 0 });
    expect(requests).toBe(0);
  });

  it('refuses to spend a request when base URL or model is missing', async () => {
    expect(await runProviderTest({ ...llmReq(), model: '' }, 'sk-x', deps())).toMatchObject({
      ok: false,
      code: 'MODEL_NOT_FOUND',
    });
    expect(await runProviderTest({ ...llmReq(), baseUrl: '  ' }, 'sk-x', deps())).toMatchObject({
      ok: false,
      code: 'MODEL_NOT_FOUND',
    });
    expect(requests).toBe(0);
  });

  // ---- segment ASR ----

  it('asr-segment: posts the bundled clip through the real cloud engine', async () => {
    behavior = { kind: 'ok', content: '测试' };
    const r = await runProviderTest(segReq(), 'sk-mimo-1234', deps());
    expect(r.ok).toBe(true);
    expect(captured.url).toBe('/v1/chat/completions');
    expect(captured.auth).toBe('Bearer sk-mimo-1234');
    const content = (captured.body as { messages: { content: { type: string; input_audio?: { data: string; format: string } }[] }[] })
      .messages[0].content[0];
    expect(content.type).toBe('input_audio');
    expect(content.input_audio?.format).toBe('wav');
    const sent = Buffer.from(content.input_audio!.data, 'base64');
    // re-encoded from the decoded fixture: same sample count, same 16 kHz mono
    expect(sent.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(sent.readUInt32LE(24)).toBe(16000);
    expect(sent.readUInt16LE(22)).toBe(1);
    expect(sent.length).toBe(44 + PCM_ZH.length * 2);
  });

  it('asr-segment: an empty transcription is still a transport+auth pass', async () => {
    behavior = { kind: 'ok', content: '' };
    expect((await runProviderTest(segReq(), 'sk-mimo-1234', deps())).ok).toBe(true);
  });

  it('asr-segment: 401 maps to INVALID_KEY', async () => {
    behavior = { kind: 'status', status: 401, body: '{"error":"unauthorized"}' };
    expect(await runProviderTest(segReq(), 'sk-bad', deps())).toMatchObject({
      ok: false,
      code: 'INVALID_KEY',
    });
  });

  it('asr-segment: picks the English clip when the language says so', async () => {
    const seen: string[] = [];
    behavior = { kind: 'ok', content: 'test' };
    await runProviderTest(
      { ...segReq(), language: 'english' },
      'sk-mimo-1234',
      deps({
        readTestAudio: (language) => {
          seen.push(language);
          return decodeWav16kMono(language === 'english' ? FIXTURE_EN : FIXTURE_ZH);
        },
      }),
    );
    expect(seen).toEqual(['english']);
  });

  // ---- single-key plan (mimo-simple) ----

  it('mimo-simple: one key drives both halves and each is reported separately', async () => {
    behavior = { kind: 'ok', content: 'ok' };
    const plan = await runSingleKeyPlanTest([llmReq(), segReq()], 'sk-mimo-1234', deps());
    expect(plan.ok).toBe(true);
    expect(plan.results.map((r) => r.capability)).toEqual(['text-llm', 'asr-segment']);
    expect(plan.results.map((r) => r.slot)).toEqual(['llm', 'asr-cloud']);
    expect(plan.results.every((r) => r.result.ok)).toBe(true);
  });

  it('mimo-simple: the plan fails when only one half works, keeping both rows', async () => {
    let call = 0;
    const plan = await runSingleKeyPlanTest(
      [llmReq(), segReq()],
      'sk-mimo-1234',
      deps({
        chatOnce: async () => {
          call += 1;
          return { text: '' };
        },
        loadSegmentEngine: async () => ({
          transcribe: async () => {
            throw new Error('cloud ASR HTTP 403: {"error":"model not activated"}');
          },
        }),
      }),
    );
    expect(call).toBe(1);
    expect(plan.ok).toBe(false);
    expect(plan.results[0].result.ok).toBe(true);
    expect(plan.results[1].result).toMatchObject({ ok: false, code: 'PERMISSION_DENIED' });
  });
});

// ------------------------------------------------------------- vision seam

describe('runProviderTest — vision', () => {
  const visionReq = (): ProviderTestRequest => ({
    capability: 'vision',
    providerId: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-2.5-flash',
    proxyUrl: '127.0.0.1:7897',
    slot: 'vision',
  });

  it('sends the bundled image and the configured proxy through the vision transport', async () => {
    let seenConfig: Record<string, unknown> | undefined;
    let seenMessages: unknown;
    const r = await runProviderTest(
      visionReq(),
      'sk-vision-1234',
      deps({
        readTestImage: () => 'data:image/png;base64,IMAGEBYTES',
        visionChat: async (config, messages) => {
          seenConfig = config as unknown as Record<string, unknown>;
          seenMessages = messages;
          return 'ok';
        },
      }),
    );
    expect(r.ok).toBe(true);
    expect(seenConfig).toMatchObject({
      model: 'gemini-2.5-flash',
      apiKey: 'sk-vision-1234',
      proxyUrl: '127.0.0.1:7897',
    });
    expect(JSON.stringify(seenMessages)).toContain('data:image/png;base64,IMAGEBYTES');
  });

  it('maps a proxy failure to PROXY_ERROR without blocking anything', async () => {
    const r = await runProviderTest(
      visionReq(),
      'sk-vision-1234',
      deps({
        visionChat: async () => {
          throw Object.assign(new Error('net::ERR_PROXY_CONNECTION_FAILED'), {
            code: 'ERR_PROXY_CONNECTION_FAILED',
          });
        },
      }),
    );
    expect(r).toMatchObject({ ok: false, code: 'PROXY_ERROR' });
  });

  it('maps a 403 from the vision provider to PERMISSION_DENIED', async () => {
    const r = await runProviderTest(
      visionReq(),
      'sk-vision-1234',
      deps({
        visionChat: async () => {
          throw new Error('Vision HTTP 403: {"error":{"message":"API not enabled"}}');
        },
      }),
    );
    expect(r).toMatchObject({ ok: false, code: 'PERMISSION_DENIED', retryable: false });
  });
});

// ----------------------------------------------------- realtime ASR (WS)

interface WsHarness {
  url: string;
  close(): Promise<void>;
  authHeader(): string | undefined;
  runTask(): Record<string, any> | undefined;
}

type WsMode = 'started' | 'task-failed-key' | 'task-failed-arrears' | 'silent';

async function startWsServer(mode: WsMode, reject401 = false): Promise<WsHarness> {
  const wss = new WebSocketServer({
    port: 0,
    host: '127.0.0.1',
    ...(reject401
      ? { verifyClient: (_info: unknown, cb: (ok: boolean, code?: number) => void) => cb(false, 401) }
      : {}),
  });
  await new Promise<void>((r) => wss.on('listening', () => r()));
  let auth: string | undefined;
  let runTask: Record<string, any> | undefined;

  wss.on('connection', (ws: WsSocket, req: IncomingMessage) => {
    auth = req.headers.authorization;
    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      const msg = JSON.parse(data.toString());
      const taskId = msg?.header?.task_id;
      if (msg?.header?.action === 'run-task') {
        runTask = msg;
        if (mode === 'silent') return;
        if (mode === 'started') {
          ws.send(JSON.stringify({ header: { event: 'task-started', task_id: taskId }, payload: {} }));
          return;
        }
        const failure =
          mode === 'task-failed-key'
            ? { error_code: 'InvalidApiKey', error_message: 'Invalid API-key provided.' }
            : { error_code: 'Arrearage', error_message: 'Account is in arrears.' };
        ws.send(JSON.stringify({ header: { event: 'task-failed', task_id: taskId, ...failure } }));
      } else if (msg?.header?.action === 'finish-task') {
        ws.send(JSON.stringify({ header: { event: 'task-finished', task_id: taskId }, payload: {} }));
      }
    });
  });

  const port = (wss.address() as AddressInfo).port;
  return {
    url: `ws://127.0.0.1:${port}`,
    close: () => new Promise<void>((r) => wss.close(() => r())),
    authHeader: () => auth,
    runTask: () => runTask,
  };
}

describe('runProviderTest — realtime ASR over a mock DashScope socket', () => {
  let harness: WsHarness | null = null;

  afterEach(async () => {
    await harness?.close();
    harness = null;
  });

  const rtReq = (url: string): ProviderTestRequest => ({
    capability: 'asr-realtime',
    providerId: 'aliyun-dashscope-cn',
    baseUrl: url,
    model: 'fun-asr-realtime',
    slot: 'asr-realtime',
    language: 'chinese',
  });

  it('passes when the service reports task-started, and sends the real run-task shape', async () => {
    harness = await startWsServer('started');
    const r = await runProviderTest(rtReq(harness.url), 'sk-rt-1234', deps());
    expect(r).toMatchObject({ ok: true, code: 'OK' });
    expect(harness.authHeader()).toBe('Bearer sk-rt-1234');
    const task = harness.runTask()!;
    expect(task.header.action).toBe('run-task');
    expect(task.header.streaming).toBe('duplex');
    expect(task.payload.model).toBe('fun-asr-realtime');
    expect(task.payload.parameters).toMatchObject({
      format: 'pcm',
      sample_rate: 16000,
      language_hints: ['zh'],
    });
  });

  it('reads a rejected WebSocket upgrade (HTTP 401) as INVALID_KEY', async () => {
    harness = await startWsServer('started', true);
    expect(await runProviderTest(rtReq(harness.url), 'sk-bad-1234', deps())).toMatchObject({
      ok: false,
      code: 'INVALID_KEY',
    });
  });

  it('maps a task-failed InvalidApiKey frame to INVALID_KEY', async () => {
    harness = await startWsServer('task-failed-key');
    expect(await runProviderTest(rtReq(harness.url), 'sk-bad-1234', deps())).toMatchObject({
      ok: false,
      code: 'INVALID_KEY',
    });
  });

  it('maps a task-failed Arrearage frame to INSUFFICIENT_BALANCE', async () => {
    harness = await startWsServer('task-failed-arrears');
    expect(await runProviderTest(rtReq(harness.url), 'sk-rt-1234', deps())).toMatchObject({
      ok: false,
      code: 'INSUFFICIENT_BALANCE',
      retryable: false,
    });
  });

  it('does not report success when the socket opens but the task never starts', async () => {
    harness = await startWsServer('silent');
    const r = await runProviderTest(rtReq(harness.url), 'sk-rt-1234', deps({ timeoutMs: 300 }));
    expect(r).toMatchObject({ ok: false, code: 'TIMEOUT' });
  });

  it('refuses an unreachable realtime endpoint without hanging', async () => {
    const r = await runProviderTest(
      rtReq('ws://127.0.0.1:1'),
      'sk-rt-1234',
      deps({ timeoutMs: 2_000 }),
    );
    expect(r.ok).toBe(false);
    expect(['NETWORK_UNREACHABLE', 'TIMEOUT']).toContain(r.code);
  });
});
