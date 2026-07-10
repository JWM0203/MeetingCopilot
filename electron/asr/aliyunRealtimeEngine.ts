/**
 * Aliyun DashScope streaming ASR engine (`fun-asr-realtime` /
 * `paraformer-realtime-v2`): true duplex streaming over WebSocket — audio
 * frames go up continuously, partial + final sentences come back as
 * `result-generated` events (the service does its own sentence endpointing).
 *
 * Protocol (Model Studio "实时语音识别 WebSocket API"):
 *   client:  run-task → <binary pcm16 frames…> → finish-task
 *   server:  task-started → result-generated… → task-finished | task-failed
 *
 * Endpoint is workspace-scoped:
 *   wss://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference
 * Auth: `Authorization: Bearer <key>` on the WS handshake (needs the `ws`
 * package — Node's built-in WebSocket cannot set headers).
 *
 * China-direct, no proxy. The local VAD stays the privacy/cost gate: a
 * session only exists while someone is speaking (plus a short tail).
 */
import { randomUUID } from 'crypto';
import WebSocket from 'ws';
import type {
  AsrEngine,
  StreamingAsrEngine,
  StreamingSession,
  StreamingSessionCallbacks,
  TranscribeResult,
} from './engine';
import type { CloudAsrConfig } from './cloudEngine';

/** float32 [-1,1] -> 16-bit little-endian PCM (the wire format). */
export function f32ToPcm16(pcm: Float32Array): Buffer {
  const buf = Buffer.allocUnsafe(pcm.length * 2);
  for (let i = 0; i < pcm.length; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]));
    buf.writeInt16LE(s < 0 ? (s * 0x8000) | 0 : (s * 0x7fff) | 0, i * 2);
  }
  return buf;
}

/** map our language setting to DashScope language_hints (omit for auto). */
export function languageHints(language?: 'auto' | string): string[] | undefined {
  if (language === 'chinese') return ['zh'];
  if (language === 'english') return ['en'];
  return undefined; // auto: let the service detect (fun-asr handles zh/en mixing)
}

// ---- server event shapes (subset we consume) ----

interface ServerEvent {
  header?: { event?: string; task_id?: string; error_code?: string; error_message?: string };
  payload?: {
    output?: {
      sentence?: {
        begin_time?: number;
        end_time?: number;
        text?: string;
        heartbeat?: boolean;
        sentence_end?: boolean;
      };
    };
  };
}

/** parse one server text frame; returns null on garbage (pure, tested). */
export function parseServerEvent(data: string): ServerEvent | null {
  try {
    const j = JSON.parse(data) as ServerEvent;
    return j && typeof j === 'object' ? j : null;
  } catch {
    return null;
  }
}

const FINISH_TIMEOUT_MS = 5000;

class AliyunRtSession implements StreamingSession {
  private ws: WebSocket;
  private readonly taskId = randomUUID();
  private started = false;
  private dead = false;
  private pending: Buffer[] = [];
  private finishResolve: (() => void) | null = null;

  constructor(
    cfg: CloudAsrConfig,
    private readonly cb: StreamingSessionCallbacks,
    language?: 'auto' | string,
  ) {
    this.ws = new WebSocket(cfg.baseUrl, {
      // local sidecar (ws://127.0.0.1) needs no auth; omit the header entirely
      headers: cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {},
      handshakeTimeout: 10_000,
    });

    this.ws.on('open', () => {
      const hints = languageHints(language);
      const runTask = {
        header: { action: 'run-task', task_id: this.taskId, streaming: 'duplex' },
        payload: {
          task_group: 'audio',
          task: 'asr',
          function: 'recognition',
          model: cfg.model,
          parameters: {
            format: 'pcm',
            sample_rate: 16000,
            ...(hints ? { language_hints: hints } : {}),
          },
          input: {},
        },
      };
      this.ws.send(JSON.stringify(runTask));
    });

    this.ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      const ev = parseServerEvent(data.toString());
      const kind = ev?.header?.event;
      if (!kind) return;
      if (kind === 'task-started') {
        this.started = true;
        for (const b of this.pending) this.ws.send(b);
        this.pending = [];
      } else if (kind === 'result-generated') {
        const s = ev!.payload?.output?.sentence;
        if (!s || s.heartbeat) return;
        const text = (s.text ?? '').trim();
        if (!text) return;
        if (s.sentence_end) {
          this.cb.onSentence({ text, beginMs: s.begin_time ?? 0, endMs: s.end_time ?? 0 });
        } else {
          this.cb.onPartial(text);
        }
      } else if (kind === 'task-finished') {
        this.settleFinish();
        this.ws.close();
      } else if (kind === 'task-failed') {
        const msg = `${ev!.header?.error_code ?? 'ERROR'}: ${ev!.header?.error_message ?? 'task failed'}`;
        this.fail(msg);
      }
    });

    this.ws.on('error', (e) => this.fail(`ws error: ${e.message}`));
    this.ws.on('close', () => {
      // close without task-finished while we still expect results = failure
      if (!this.dead && this.finishResolve) this.settleFinish();
    });
  }

  private fail(message: string): void {
    if (this.dead) return;
    this.dead = true;
    this.settleFinish();
    try {
      this.ws.terminate();
    } catch {
      /* already closed */
    }
    this.cb.onError(message);
  }

  private settleFinish(): void {
    const r = this.finishResolve;
    this.finishResolve = null;
    r?.();
  }

  push(pcm: Float32Array): void {
    if (this.dead || pcm.length === 0) return;
    const buf = f32ToPcm16(pcm);
    if (this.started && this.ws.readyState === WebSocket.OPEN) this.ws.send(buf);
    else this.pending.push(buf);
  }

  async close(): Promise<void> {
    if (this.dead) return;
    this.dead = true;
    if (this.ws.readyState !== WebSocket.OPEN || !this.started) {
      // never got going — just tear down
      try {
        this.ws.terminate();
      } catch {
        /* noop */
      }
      return;
    }
    const finishTask = {
      header: { action: 'finish-task', task_id: this.taskId, streaming: 'duplex' },
      payload: { input: {} },
    };
    const finished = new Promise<void>((res) => {
      this.finishResolve = res;
    });
    this.ws.send(JSON.stringify(finishTask));
    const timeout = new Promise<void>((res) => setTimeout(res, FINISH_TIMEOUT_MS).unref?.());
    await Promise.race([finished, timeout]);
    try {
      this.ws.terminate();
    } catch {
      /* noop */
    }
  }
}

export class AliyunRealtimeEngine implements StreamingAsrEngine, AsrEngine {
  readonly ep = 'cloud-rt';
  readonly streaming = true as const;
  readonly loadMs = 0;
  warmMs = 0;
  readonly lidAvailable = false;

  private constructor(private readonly cfg: CloudAsrConfig) {}

  static async load(cfg: CloudAsrConfig): Promise<AliyunRealtimeEngine> {
    if (!cfg.baseUrl || !cfg.model) {
      throw new Error('流式 ASR 未配置（需要 ws(s) 地址 / 模型）');
    }
    if (!/^wss?:\/\//.test(cfg.baseUrl)) {
      throw new Error(`流式 ASR 地址必须是 ws:// 或 wss:// 开头（当前: ${cfg.baseUrl}）`);
    }
    // remote (wss) requires a key; the local ws:// sidecar does not
    if (/^wss:\/\//.test(cfg.baseUrl) && !cfg.apiKey) {
      throw new Error('云端流式 ASR 需要 API Key');
    }
    return new AliyunRealtimeEngine(cfg);
  }

  async warmup(): Promise<number> {
    return 0; // stateless per-session; nothing to warm
  }

  openSession(cb: StreamingSessionCallbacks, opts?: { language?: 'auto' | string }): StreamingSession {
    return new AliyunRtSession(this.cfg, cb, opts?.language);
  }

  /**
   * One-shot compatibility path (harness / worker partial fallback): stream
   * the whole clip through a throwaway session and join the sentences.
   */
  async transcribe(pcm: Float32Array, language: 'auto' | string): Promise<TranscribeResult> {
    const t0 = Date.now();
    const parts: string[] = [];
    let err: string | null = null;
    const session = this.openSession(
      {
        onPartial: () => undefined,
        onSentence: (s) => parts.push(s.text),
        onError: (m) => {
          err = m;
        },
      },
      { language },
    );
    const CHUNK = 1600; // 100 ms
    for (let off = 0; off < pcm.length; off += CHUNK) {
      session.push(pcm.subarray(off, Math.min(off + CHUNK, pcm.length)));
    }
    await session.close();
    if (err && parts.length === 0) throw new Error(err);
    return { text: parts.join(' ').trim(), lang: undefined, inferMs: Date.now() - t0 };
  }
}
