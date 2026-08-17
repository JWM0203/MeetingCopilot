/**
 * Provider connection tests (Phase 3, spec §B).
 *
 * One real, minimal request per capability, so "保存并测试连接" answers the only
 * question that matters before a meeting starts: does THIS key reach THIS
 * model right now. Every path reuses the transport the app itself uses at
 * runtime — a test that passed through a different client would prove nothing.
 *
 * Hard rules enforced here:
 *  - the key exists only as a local `apiKey` argument; it is never logged,
 *    never written to disk by this module and never echoed into a result;
 *  - 12 s ceiling per test (AbortController where the transport honours one,
 *    a race everywhere else) so a black-holed connection cannot hang the UI;
 *  - nothing is written to sessions, transcripts or the knowledge base;
 *  - no prewarm, no engine start, no side effects on the running app.
 *
 * Every outward call is a dependency so the suite can mock at the seam: the
 * LLM and segment-ASR paths run against a local HTTP server, the realtime path
 * against a local WebSocket server, and vision (which needs electron's `net`)
 * against a stub.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import type {
  AsrLanguage,
  ProviderSlot,
  ProviderTestRequest,
  ProviderTestResult,
} from '../shared/protocol';
import type { ProviderCapability } from '../shared/providerCatalog';
import { chatOnce, type ChatMessage, type LlmConfig } from './llm/adapter';
import type { VisionConfig } from './llm/vision';
import { AliyunRealtimeEngine } from './asr/aliyunRealtimeEngine';
import { CloudAsrEngine, type CloudAsrConfig } from './asr/cloudEngine';
import type { StreamingSession, StreamingSessionCallbacks } from './asr/engine';
import { decodeWav16kMono } from './asr/wavRead';
import { getResourceRoot } from './resourcePaths';
import {
  PROVIDER_TEST_MESSAGES,
  isRetryable,
  normalizeProviderError,
  type ProviderErrorContext,
} from './providerErrors';

/** the whole test, connection included, must finish inside this budget */
export const PROVIDER_TEST_TIMEOUT_MS = 12_000;

/** the realtime session is torn down politely, but never at the user's expense */
const REALTIME_CLOSE_BUDGET_MS = 3_000;

// ---------- injectable seams ----------

type ChatOnceFn = (
  config: LlmConfig,
  messages: ChatMessage[],
  opts?: { maxTokens?: number; temperature?: number; signal?: AbortSignal },
) => Promise<{ text: string }>;

type VisionChatFn = (
  config: VisionConfig,
  messages: ChatMessage[],
  signal?: AbortSignal,
) => Promise<string>;

/** the slice of AliyunRealtimeEngine a connection test uses */
export interface RealtimeEngineLike {
  openSession(cb: StreamingSessionCallbacks, opts?: { language?: 'auto' | string }): StreamingSession;
}

/** the slice of CloudAsrEngine a connection test uses */
export interface SegmentEngineLike {
  transcribe(pcm: Float32Array, language: 'auto' | string): Promise<{ text: string }>;
}

export interface ProviderTestDeps {
  chatOnce: ChatOnceFn;
  visionChat: VisionChatFn;
  loadRealtimeEngine(cfg: CloudAsrConfig): Promise<RealtimeEngineLike>;
  loadSegmentEngine(cfg: CloudAsrConfig): Promise<SegmentEngineLike>;
  /** 16 kHz mono float32 of the bundled ~1.4 s clip */
  readTestAudio(language: AsrLanguage): Float32Array;
  /** data: URL of the bundled 64x64 PNG */
  readTestImage(): string;
  timeoutMs: number;
  now(): number;
}

/**
 * Bundled fixture path. `getResourceRoot()` is the repo root in development
 * and `resources/` in a packaged build, and electron-builder maps
 * `resources/** ` to the same relative sub-path, so this one join is correct
 * on both sides (see electron-builder.yml `extraResources`).
 */
export function testAssetPath(...segments: string[]): string {
  return join(getResourceRoot(), 'resources', ...segments);
}

export const defaultProviderTestDeps: ProviderTestDeps = {
  chatOnce,
  // lazily imported: electron/llm/vision.ts pulls in electron's `net`, which
  // has no business loading in the unit-test process
  visionChat: async (config, messages, signal) =>
    (await import('./llm/vision')).visionChat(config, messages, signal),
  loadRealtimeEngine: (cfg) => AliyunRealtimeEngine.load(cfg),
  loadSegmentEngine: (cfg) => CloudAsrEngine.load(cfg),
  readTestAudio: (language) =>
    decodeWav16kMono(
      readFileSync(
        testAssetPath('test-audio', language === 'english' ? 'asr-test-en.wav' : 'asr-test-zh.wav'),
      ),
    ),
  readTestImage: () =>
    `data:image/png;base64,${readFileSync(testAssetPath('test-image.png')).toString('base64')}`,
  timeoutMs: PROVIDER_TEST_TIMEOUT_MS,
  now: () => Date.now(),
};

// ---------- key resolution ----------

/**
 * Which key this test runs with.
 *
 * A freshly typed candidate ALWAYS wins: the user pressed 保存并测试连接 to find
 * out whether that key works, and falling back to the stored one would show
 * them a green tick for a key they are about to replace.
 *
 * Without a candidate, a key is used only when the caller explicitly asked for
 * the stored one AND named the slot. There is deliberately no "guess the slot"
 * path: sending the LLM key to a realtime ASR endpoint would burn a request
 * and produce a misleading INVALID_KEY.
 */
export function resolveTestApiKey(
  req: ProviderTestRequest,
  storedKeyForSlot: (slot: ProviderSlot) => string | undefined,
): string {
  const candidate = req.candidateApiKey?.trim();
  if (candidate) return candidate;
  if (req.useStoredKey && req.slot) return storedKeyForSlot(req.slot)?.trim() ?? '';
  return '';
}

/**
 * Drop the plaintext candidate before the request travels any further. The key
 * then exists only as the separate `apiKey` argument of {@link runProviderTest}
 * — it cannot be logged with the request, stored with it, or returned in it.
 */
export function withoutCandidateKey(req: ProviderTestRequest): ProviderTestRequest {
  const { candidateApiKey: _dropped, ...rest } = req;
  return rest;
}

// ---------- helpers ----------

/** a local sidecar endpoint authenticates by being on localhost, not by key */
function isLocalWsEndpoint(baseUrl: string): boolean {
  return /^ws:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?(?:\/|$)/i.test(baseUrl.trim());
}

function timeoutError(): Error {
  // `name` is what electron/providerErrors.ts matches on -> TIMEOUT
  return Object.assign(new Error('provider connection test timed out'), { name: 'TimeoutError' });
}

/** rejects when the shared budget runs out; never resolves otherwise */
function rejectOnAbort(signal: AbortSignal): Promise<never> {
  return new Promise<never>((_resolve, reject) => {
    if (signal.aborted) {
      reject(timeoutError());
      return;
    }
    signal.addEventListener('abort', () => reject(timeoutError()), { once: true });
  });
}

function okResult(latencyMs: number): ProviderTestResult {
  return {
    ok: true,
    code: 'OK',
    latencyMs,
    messageZh: PROVIDER_TEST_MESSAGES.OK.zh,
    messageEn: PROVIDER_TEST_MESSAGES.OK.en,
    retryable: false,
  };
}

function failResult(
  err: unknown,
  ctx: ProviderErrorContext,
  latencyMs: number,
): ProviderTestResult {
  const n = normalizeProviderError(err, ctx);
  return {
    ok: false,
    code: n.code,
    latencyMs,
    messageZh: n.messageZh,
    messageEn: n.messageEn,
    providerRequestId: n.providerRequestId,
    retryable: n.retryable,
  };
}

/** a verdict we can reach without spending the user's quota */
function staticFailure(code: 'INVALID_KEY' | 'MODEL_NOT_FOUND'): ProviderTestResult {
  return {
    ok: false,
    code,
    latencyMs: 0,
    messageZh: PROVIDER_TEST_MESSAGES[code].zh,
    messageEn: PROVIDER_TEST_MESSAGES[code].en,
    retryable: isRetryable(code),
  };
}

// ---------- per-capability probes ----------

/** 1 output token, temperature 0, one throwaway word in — the cheapest call
 * an OpenAI-compatible endpoint accepts. Empty content still counts as OK:
 * the question is transport + auth + model, not the reply. */
async function testTextLlm(
  req: ProviderTestRequest,
  apiKey: string,
  deps: ProviderTestDeps,
  signal: AbortSignal,
): Promise<void> {
  await deps.chatOnce(
    { baseUrl: req.baseUrl, model: req.model, apiKey },
    [{ role: 'user', content: 'ping' }],
    { maxTokens: 1, temperature: 0, signal },
  );
}

/**
 * Success = the service reports `task-started`. Reuses the production engine
 * so the run-task payload, the auth header and the endpoint are byte-identical
 * to a real meeting; no audio is sent, and the session is finished politely.
 */
async function testAsrRealtime(
  req: ProviderTestRequest,
  apiKey: string,
  deps: ProviderTestDeps,
  signal: AbortSignal,
): Promise<void> {
  const engine = await deps.loadRealtimeEngine({
    baseUrl: req.baseUrl,
    model: req.model,
    apiKey,
  });

  let settleReady: (() => void) | null = null;
  let settleFail: ((e: Error) => void) | null = null;
  const ready = new Promise<void>((resolve) => {
    settleReady = resolve;
  });
  const failed = new Promise<never>((_resolve, reject) => {
    settleFail = (e) => reject(e);
  });

  const session = engine.openSession(
    {
      onReady: () => settleReady?.(),
      onPartial: () => undefined,
      onSentence: () => undefined,
      onError: (message) => settleFail?.(new Error(message)),
    },
    { language: req.language ?? 'auto' },
  );

  try {
    await Promise.race([ready, failed, rejectOnAbort(signal)]);
  } finally {
    // a hung teardown must not become the user's problem
    const closed = session.close().catch(() => undefined);
    const capped = new Promise<void>((resolve) => {
      setTimeout(resolve, REALTIME_CLOSE_BUDGET_MS).unref?.();
    });
    await Promise.race([closed, capped]);
  }
}

/**
 * Sends the bundled ~1.4 s clip through the production segment engine. An
 * empty transcription is still a pass — it proves transport, auth and model,
 * and a one-word clip legitimately comes back blank on some models.
 */
async function testAsrSegment(
  req: ProviderTestRequest,
  apiKey: string,
  deps: ProviderTestDeps,
  signal: AbortSignal,
): Promise<void> {
  const engine = await deps.loadSegmentEngine({
    baseUrl: req.baseUrl,
    model: req.model,
    apiKey,
  });
  const pcm = deps.readTestAudio(req.language ?? 'auto');
  // CloudAsrEngine.transcribe takes no signal; the race bounds the WAIT, the
  // in-flight request is left to finish and be discarded
  await Promise.race([engine.transcribe(pcm, req.language ?? 'auto'), rejectOnAbort(signal)]);
}

/** 64x64 PNG + a one-word prompt, through the same proxied transport the
 * screenshot feature uses. Failure here never blocks anything — vision is
 * optional — but the user still gets a mapped reason. */
async function testVision(
  req: ProviderTestRequest,
  apiKey: string,
  deps: ProviderTestDeps,
  signal: AbortSignal,
): Promise<void> {
  const messages: ChatMessage[] = [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Reply with one word: ok' },
        { type: 'image_url', image_url: { url: deps.readTestImage() } },
      ],
    },
  ];
  await deps.visionChat(
    { baseUrl: req.baseUrl, model: req.model, apiKey, proxyUrl: req.proxyUrl },
    messages,
    signal,
  );
}

// ---------- entry point ----------

/**
 * Run ONE connection test.
 *
 * `apiKey` is passed separately (already resolved from the candidate key or
 * the stored slot by the caller) so this function never touches the settings
 * store and the key stays a parameter, not state.
 */
export async function runProviderTest(
  req: ProviderTestRequest,
  apiKey: string,
  deps: ProviderTestDeps = defaultProviderTestDeps,
): Promise<ProviderTestResult> {
  const ctx: ProviderErrorContext = { capability: req.capability, providerId: req.providerId };

  if (!req.baseUrl?.trim() || !req.model?.trim()) return staticFailure('MODEL_NOT_FOUND');
  if (!apiKey && !isLocalWsEndpoint(req.baseUrl)) return staticFailure('INVALID_KEY');

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), deps.timeoutMs);
  timer.unref?.();
  const started = deps.now();

  try {
    await runCapability(req.capability, req, apiKey, deps, ac.signal);
    return okResult(deps.now() - started);
  } catch (e) {
    return failResult(ac.signal.aborted ? timeoutError() : e, ctx, deps.now() - started);
  } finally {
    clearTimeout(timer);
  }
}

function runCapability(
  capability: ProviderCapability,
  req: ProviderTestRequest,
  apiKey: string,
  deps: ProviderTestDeps,
  signal: AbortSignal,
): Promise<void> {
  switch (capability) {
    case 'text-llm':
      return testTextLlm(req, apiKey, deps, signal);
    case 'asr-realtime':
      return testAsrRealtime(req, apiKey, deps, signal);
    case 'asr-segment':
      return testAsrSegment(req, apiKey, deps, signal);
    case 'vision':
      return testVision(req, apiKey, deps, signal);
  }
}

// ---------- single-key plans (mimo-simple) ----------

export interface PlanTestOutcome {
  capability: ProviderCapability;
  /** which stored slot this row belongs to, when the caller named one */
  slot?: ProviderTestRequest['slot'];
  result: ProviderTestResult;
}

export interface PlanTestResult {
  /** the PLAN only passes when every capability it promises passes */
  ok: boolean;
  results: PlanTestOutcome[];
}

/**
 * The 极简配置 plan buys one MiMo key and expects it to drive both the text
 * model and segment ASR. Both halves are tested with the SAME key and reported
 * separately — "AI answers work, transcription does not" is the exact failure
 * this plan risks, and collapsing it into one boolean would hide it.
 *
 * Sequential on purpose: two simultaneous first requests on a brand new key
 * are a good way to get rate-limited by the provider.
 */
export async function runSingleKeyPlanTest(
  requests: readonly ProviderTestRequest[],
  apiKey: string,
  deps: ProviderTestDeps = defaultProviderTestDeps,
): Promise<PlanTestResult> {
  const results: PlanTestOutcome[] = [];
  for (const req of requests) {
    results.push({
      capability: req.capability,
      slot: req.slot,
      result: await runProviderTest(req, apiKey, deps),
    });
  }
  return { ok: results.length > 0 && results.every((r) => r.result.ok), results };
}
