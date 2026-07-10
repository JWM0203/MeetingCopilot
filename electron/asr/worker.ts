/**
 * ASR worker: VAD segmentation + Whisper turbo transcription.
 * Never blocks the Electron main thread (PLAN §3.1 hard rule).
 *
 * MUST run as an Electron utilityProcess (own OS process), NOT worker_threads:
 * DML inference inside the Electron main process hangs on real segments once
 * Chromium's GPU work is active (warmup passes, first real pipe() never
 * returns — the Natively "0 transcript segments" symptom, root-caused
 * 2026-07-09). A separate process matches the validated plain-node harness.
 * worker_threads support is kept only as a compat path for tests.
 */
import { parentPort as threadPort } from 'worker_threads';
import { VadSegmenter } from './vad';
import {
  WhisperEngine,
  isJunkTranscript,
  isStreamingEngine,
  type AsrEngine,
  type StreamingSession,
} from './engine';
import { CloudAsrEngine } from './cloudEngine';
import { AliyunRealtimeEngine } from './aliyunRealtimeEngine';
import { LanguageRouter, type LidResult } from './langRouter';
import type { WorkerInit, WorkerInMessage, WorkerOutMessage } from './contract';

// Electron utilityProcess exposes process.parentPort (MessageEvent-style).
interface UtilPort {
  on(ev: 'message', cb: (e: { data: unknown }) => void): void;
  postMessage(m: unknown): void;
}
const utilPort = (process as NodeJS.Process & { parentPort?: UtilPort }).parentPort;

if (!utilPort && !threadPort) throw new Error('asr worker must run in utilityProcess or worker_threads');

function post(msg: WorkerOutMessage): void {
  if (utilPort) utilPort.postMessage(msg);
  else threadPort!.postMessage(msg);
}

function listen(cb: (msg: WorkerInMessage) => void): void {
  if (utilPort) utilPort.on('message', (e) => cb(e.data as WorkerInMessage));
  else threadPort!.on('message', (m) => cb(m as WorkerInMessage));
}

type Channel = 'them' | 'me';

interface PendingSegment {
  pcm: Float32Array;
  startTs: number;
  endTs: number;
  vadCloseTs: number;
  speaker: Channel;
}

const MAX_QUEUE = 10;
/** idle keep-warm: re-touch DML after this much silence so the first real
 * sentence after a lull doesn't pay a cold-GPU tail (~3.5 s measured) */
const KEEPWARM_IDLE_MS = 45_000;
const KEEPWARM_CHECK_MS = 15_000;

let engine: AsrEngine | null = null;
const vads: Record<Channel, VadSegmenter> = { them: new VadSegmenter(), me: new VadSegmenter() };
const routers: Record<Channel, LanguageRouter> = { them: new LanguageRouter(), me: new LanguageRouter() };
let language: 'auto' | string = 'auto';
let queue: PendingSegment[] = [];
let transcribing = false;
let segCounter = 0;
let shuttingDown = false;
let lastInferTs = Date.now();
let partialBusy = false;
/** live partials: on for local (GPU idle), off for cloud (per-call cost) */
const PARTIAL_INTERVAL_MS = 1400;

// ---- true-streaming backend state (backend === 'cloud-realtime') ----
/** live WS session per channel; opened on speech-start, closed after idle */
const streams: Record<Channel, StreamingSession | null> = { them: null, me: null };
/** wallclock of each session's audio t=0 (maps service sentence times) */
const streamEpoch: Record<Channel, number> = { them: 0, me: 0 };
/** last time the channel's VAD saw speech (drives idle close) */
const lastSpeechAt: Record<Channel, number> = { them: 0, me: 0 };
/** ~300 ms pre-roll so the first syllable isn't clipped at session open */
const ring: Record<Channel, { pcm: Float32Array; ms: number }[]> = { them: [], me: [] };
const RING_MS = 300;
/** close the WS after this much silence (cost gate; service dies at ~23 s idle anyway) */
const STREAM_IDLE_CLOSE_MS = 10_000;

setInterval(() => {
  if (!engine || transcribing || shuttingDown || queue.length > 0) return;
  if (engine.ep.startsWith('cloud')) return; // cloud is stateless — nothing to keep warm
  if (Date.now() - lastInferTs < KEEPWARM_IDLE_MS) return;
  transcribing = true;
  const tiny = new Float32Array(4800); // 0.3 s silence
  engine
    .transcribe(tiny, 'english')
    .catch(() => undefined)
    .finally(() => {
      lastInferTs = Date.now();
      transcribing = false;
      void pump();
    });
}, KEEPWARM_CHECK_MS).unref?.();

async function handleInit(init: WorkerInit): Promise<void> {
  try {
    language = init.language;
    if (init.backend === 'cloud-realtime') {
      if (!init.cloud) throw new Error('云端流式 ASR 未配置');
      engine = await AliyunRealtimeEngine.load(init.cloud);
      post({ type: 'ready', loadMs: 0, warmMs: 0, ep: 'cloud-rt', gpuSuspect: false });
    } else if (init.backend === 'cloud') {
      if (!init.cloud) throw new Error('云端 ASR 未配置');
      engine = await CloudAsrEngine.load(init.cloud);
      post({ type: 'ready', loadMs: 0, warmMs: 0, ep: 'cloud', gpuSuspect: false });
    } else {
      const eng = await WhisperEngine.load({ modelsDir: init.modelsDir, modelId: init.modelId, ep: init.ep });
      engine = eng;
      const warmMs = await eng.warmup();
      // GPU encoder warm pass is ~120 ms; multi-second warm means CPU fallback.
      const gpuSuspect = init.ep.includes('dml') && warmMs > 4000;
      post({ type: 'ready', loadMs: eng.loadMs, warmMs, ep: eng.ep, gpuSuspect });
      // live partials only for the local GPU engine (cloud = per-call cost)
      vads.them.setPartialInterval(PARTIAL_INTERVAL_MS);
      vads.me.setPartialInterval(PARTIAL_INTERVAL_MS);
    }
    post({ type: 'status', state: 'listening', queuedSegments: 0 });
  } catch (e) {
    post({ type: 'error', message: `engine load failed: ${(e as Error).message}`, fatal: true });
  }
}

function handleVadEvents(events: ReturnType<VadSegmenter['push']>, channel: Channel): void {
  for (const ev of events) {
    if (ev.type === 'speech-start') {
      post({ type: 'status', state: 'speech', queuedSegments: queue.length });
    } else if (ev.type === 'partial') {
      void doPartial(ev.pcm, channel);
    } else if (ev.type === 'segment') {
      if (queue.length >= MAX_QUEUE) {
        queue.shift();
        post({ type: 'error', message: 'transcribe queue overflow, dropped oldest segment', fatal: false });
      }
      queue.push({ pcm: ev.pcm, startTs: ev.startTs, endTs: ev.endTs, vadCloseTs: Date.now(), speaker: channel });
      void pump();
    }
  }
}

// ---- true-streaming path: VAD is only the session gate; the service does
// sentence endpointing and pushes partial/final text itself ----

function ensureStream(ch: Channel): void {
  if (streams[ch] || !engine || !isStreamingEngine(engine)) return;
  const ringDur = ring[ch].reduce((a, c) => a + c.ms, 0);
  streamEpoch[ch] = Date.now() - ringDur;
  const epoch = streamEpoch[ch];
  const session = engine.openSession(
    {
      onPartial: (text) => {
        if (!shuttingDown && !isJunkTranscript(text)) post({ type: 'partial', speaker: ch, text });
      },
      onSentence: (s) => {
        if (shuttingDown || isJunkTranscript(s.text)) return;
        const now = Date.now();
        post({
          type: 'segment',
          id: ++segCounter,
          text: s.text,
          lang: undefined,
          speaker: ch,
          audioMs: Math.max(0, s.endMs - s.beginMs),
          speechStartTs: epoch + s.beginMs,
          speechEndTs: epoch + s.endMs,
          vadCloseTs: epoch + s.endMs,
          inferStartTs: epoch + s.endMs,
          inferEndTs: now,
        });
      },
      onError: (message) => {
        streams[ch] = null;
        if (!shuttingDown) post({ type: 'error', message: `streaming ASR (${ch}): ${message}`, fatal: false });
      },
    },
    { language },
  );
  // flush pre-roll first so the first syllable survives, then live frames follow
  for (const c of ring[ch]) session.push(c.pcm);
  ring[ch] = [];
  streams[ch] = session;
  console.log(`[worker] stream open ch=${ch}`);
}

function closeStream(ch: Channel): void {
  const s = streams[ch];
  if (!s) return;
  streams[ch] = null;
  console.log(`[worker] stream close ch=${ch}`);
  void s.close().catch(() => undefined);
}

function handleStreamingPcm(pcm: Float32Array, ch: Channel, captureTs: number): void {
  const events = vads[ch].push(pcm, captureTs);
  for (const ev of events) {
    if (ev.type === 'speech-start') {
      lastSpeechAt[ch] = Date.now();
      post({ type: 'status', state: 'speech', queuedSegments: 0 });
      ensureStream(ch);
    } else if (ev.type === 'segment') {
      // local VAD closed the utterance; keep the WS open for the service's own
      // finalization + possible follow-up sentence (idle timer reaps it)
      post({ type: 'status', state: 'listening', queuedSegments: 0 });
    }
    // 'partial' VAD events are meaningless here (service streams its own)
  }
  if (vads[ch].state === 'speech') lastSpeechAt[ch] = Date.now();

  const frameMs = (pcm.length / 16000) * 1000;
  if (streams[ch]) {
    // stream every frame (speech AND trailing silence) so the service's
    // sentence timing stays continuous; cost is bounded by the idle close
    streams[ch]!.push(pcm);
  } else {
    ring[ch].push({ pcm, ms: frameMs });
    let held = ring[ch].reduce((a, c) => a + c.ms, 0);
    while (held > RING_MS && ring[ch].length > 1) {
      held -= ring[ch][0].ms;
      ring[ch].shift();
    }
  }
}

/** reap idle streaming sessions (nobody spoke for STREAM_IDLE_CLOSE_MS) */
setInterval(() => {
  if (!engine || !isStreamingEngine(engine) || shuttingDown) return;
  for (const ch of ['them', 'me'] as Channel[]) {
    if (streams[ch] && vads[ch].state !== 'speech' && Date.now() - lastSpeechAt[ch] > STREAM_IDLE_CLOSE_MS) {
      closeStream(ch);
    }
  }
}, 2000).unref?.();

/**
 * Live partial: transcribe the open segment so far and emit a transient text.
 * Never delays a final (skips when the queue is busy) and drops if one is
 * already in flight (latest-wins). Uses the channel's sticky language to avoid
 * paying for LID on every partial.
 */
async function doPartial(pcm: Float32Array, channel: Channel): Promise<void> {
  if (!engine || transcribing || partialBusy || queue.length > 0 || shuttingDown) return;
  partialBusy = true;
  try {
    const lang = language === 'auto' ? routers[channel].currentLang : language;
    const r = await engine.transcribe(pcm, lang);
    if (!isJunkTranscript(r.text) && !transcribing) {
      post({ type: 'partial', speaker: channel, text: r.text });
    }
  } catch {
    /* partials are best-effort */
  } finally {
    partialBusy = false;
    void pump(); // a final may have queued while the partial was running
  }
}

async function pump(): Promise<void> {
  if (transcribing || partialBusy || !engine || shuttingDown) return;
  const seg = queue.shift();
  if (!seg) {
    const speaking = vads.them.state === 'speech' || vads.me.state === 'speech';
    post({ type: 'status', state: speaking ? 'speech' : 'listening', queuedSegments: 0 });
    return;
  }
  transcribing = true;
  post({ type: 'status', state: 'transcribing', queuedSegments: queue.length });
  const inferStartTs = Date.now();
  const audioMs = Math.round(seg.pcm.length / 16);

  // 'auto' = real zh/en LID (one decoder step) + sticky routing; an explicit
  // setting bypasses detection entirely.
  const router = routers[seg.speaker];
  let effLang: string = language;
  if (language === 'auto' && engine.detectZhEn) {
    let lid: LidResult | null = null;
    if (router.shouldRunLid(audioMs)) {
      try {
        const r = await engine.detectZhEn(seg.pcm);
        if (r) {
          lid = { lang: r.lang, margin: r.margin };
          console.log(`[worker] lid ${r.lang} margin=${r.margin.toFixed(2)} ${r.lidMs}ms`);
        }
      } catch (e) {
        console.warn(`[worker] lid failed: ${(e as Error).message}`);
      }
    }
    effLang = router.decide(audioMs, lid);
  }

  console.log(`[worker] transcribe start speaker=${seg.speaker} audio=${audioMs}ms lang=${effLang}`);
  try {
    const r = await engine.transcribe(seg.pcm, effLang);
    const inferEndTs = Date.now();
    console.log(
      `[worker] seg audio=${audioMs}ms lang=${effLang} infer=${inferEndTs - inferStartTs}ms raw=${JSON.stringify(r.text.slice(0, 80))}`,
    );
    if (process.env.MC_DEBUG_DUMP === '1') {
      const { writeFileSync } = await import('fs');
      writeFileSync(`${process.env.TEMP}/mc-seg-${Date.now()}.f32`, Buffer.from(seg.pcm.buffer, seg.pcm.byteOffset, seg.pcm.byteLength));
    }
    if (!isJunkTranscript(r.text)) {
      post({
        type: 'segment',
        id: ++segCounter,
        text: r.text,
        lang: r.lang ?? (effLang === 'auto' ? undefined : effLang),
        speaker: seg.speaker,
        audioMs,
        speechStartTs: seg.startTs,
        speechEndTs: seg.endTs,
        vadCloseTs: seg.vadCloseTs,
        inferStartTs,
        inferEndTs,
      });
    }
  } catch (e) {
    post({ type: 'error', message: `transcribe failed: ${(e as Error).message}`, fatal: false });
  } finally {
    lastInferTs = Date.now();
    transcribing = false;
    void pump();
  }
}

listen((msg: WorkerInMessage) => {
  switch (msg.type) {
    case 'init':
      void handleInit(msg);
      break;
    case 'pcm': {
      if (!engine) break;
      // serializers may deliver the payload as ArrayBuffer/Uint8Array
      const pcm =
        msg.pcm instanceof Float32Array
          ? msg.pcm
          : new Float32Array(
              (msg.pcm as unknown as ArrayBufferView).buffer ?? (msg.pcm as unknown as ArrayBuffer),
            );
      const ch: Channel = msg.channel === 'me' ? 'me' : 'them';
      if (isStreamingEngine(engine)) handleStreamingPcm(pcm, ch, msg.captureTs);
      else handleVadEvents(vads[ch].push(pcm, msg.captureTs), ch);
      break;
    }
    case 'config':
      if (msg.language) language = msg.language;
      break;
    case 'flush':
      if (engine && isStreamingEngine(engine)) {
        vads.them.flush();
        vads.me.flush();
        closeStream('them');
        closeStream('me');
        post({ type: 'status', state: 'listening', queuedSegments: 0 });
      } else {
        handleVadEvents(vads.them.flush(), 'them');
        handleVadEvents(vads.me.flush(), 'me');
      }
      break;
    case 'shutdown':
      shuttingDown = true;
      queue = [];
      closeStream('them');
      closeStream('me');
      setImmediate(() => process.exit(0));
      break;
  }
});
