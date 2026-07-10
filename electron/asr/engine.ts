/**
 * Whisper turbo fp16 engine on onnxruntime (DirectML GPU), via
 * @huggingface/transformers 3.8.1 + the cache_position patch (patches/).
 *
 * Validated in the 2026-07-09 probe session: encoder DML 117 ms vs CPU
 * 7312 ms (62.5x) on RTX 5070 Ti; real Chinese audio transcribed correctly.
 * Do NOT upgrade transformers.js to 4.x (major; drags onnxruntime-node 1.24
 * + new native deps).
 */
import { createRequire } from 'module';
import { dirname, join } from 'path';
import { existsSync } from 'fs';
import { pathToFileURL } from 'url';

export interface EngineInit {
  modelsDir: string;
  modelId: string;
  ep: ('dml' | 'cpu')[];
}

export interface TranscribeResult {
  text: string;
  lang?: string;
  inferMs: number;
}

export interface EngineLidResult {
  lang: 'chinese' | 'english';
  margin: number;
  lidMs: number;
}

/**
 * Common ASR engine contract so the worker swaps local (Whisper) ↔ cloud
 * (MiMo) with no other change. `detectZhEn` is optional: cloud ASR
 * auto-detects language server-side, so it has no local LID.
 */
export interface AsrEngine {
  readonly ep: string;
  readonly loadMs: number;
  warmMs: number;
  readonly lidAvailable: boolean;
  warmup(): Promise<number>;
  transcribe(pcm: Float32Array, language: 'auto' | string): Promise<TranscribeResult>;
  detectZhEn?(pcm: Float32Array): Promise<EngineLidResult | null>;
}

// ---- true streaming (audio in / text out over one live connection) ----

/** one finalized sentence from the streaming service; times are ms relative
 * to the session's first audio sample */
export interface StreamingSentence {
  text: string;
  beginMs: number;
  endMs: number;
}

export interface StreamingSessionCallbacks {
  /** transient partial for the sentence currently being spoken */
  onPartial(text: string): void;
  /** a sentence the service finalized (its own endpointing, not our VAD) */
  onSentence(s: StreamingSentence): void;
  /** connection/task failure; the session is dead after this */
  onError(message: string): void;
}

/** a live audio→text stream; one per channel (them/me), short-lived */
export interface StreamingSession {
  /** feed one 16 kHz mono float32 frame; safe to call before the connection
   * is ready (frames are buffered and flushed on task start) */
  push(pcm: Float32Array): void;
  /** graceful finish (flush + wait for the service to finalize) */
  close(): Promise<void>;
}

export interface StreamingAsrEngine extends AsrEngine {
  readonly streaming: true;
  /** open a live session; returns synchronously, connects in the background */
  openSession(cb: StreamingSessionCallbacks, opts?: { language?: 'auto' | string }): StreamingSession;
}

export function isStreamingEngine(e: AsrEngine): e is StreamingAsrEngine {
  return (e as { streaming?: boolean }).streaming === true;
}

/** IEEE 754 half-precision (uint16 bits) -> float. Exported for tests. */
export function halfToFloat(h: number): number {
  const sign = (h & 0x8000) ? -1 : 1;
  const exp = (h >> 10) & 0x1f;
  const frac = h & 0x3ff;
  if (exp === 0) return sign * frac * 2 ** -24;
  if (exp === 0x1f) return frac ? NaN : sign * Infinity;
  return sign * (1 + frac / 1024) * 2 ** (exp - 15);
}

/**
 * Winning config (measured 2026-07-09 on RTX 5070 Ti + 24-core CPU):
 * - encoder fp16 on DirectML: ~150 ms (vs 7.3 s CPU)
 * - decoder q8 on CPU (6 threads): ~40 ms/token int8 kernels
 *   => 3.5 s utterance 762 ms, 10.4 s utterance 1540 ms, budget met.
 * Decoder fp16 ON DML produces garbage logits (empty token_ids crash) — the
 * likely root cause of Natively's "0 transcript segments". Decoder fp16 on
 * CPU works but is ~2.4x slower than q8 (fp16 emulated via fp32 casts).
 */
const DECODER_THREADS = 6;

/**
 * Import the patched node ESM build explicitly. The bare specifier is only a
 * fallback: resolving the file path ourselves guarantees we load
 * dist/transformers.node.mjs (the file patch-package patches) regardless of
 * how the bundler treats the dynamic import.
 *
 * `new Function` keeps the dynamic import out of the bundler's reach — the
 * worker is bundled to CJS, and a rollup-rewritten `import()` would become
 * `require()` and choke on the ESM build.
 */
const dynamicImport = new Function('u', 'return import(u)') as (u: string) => Promise<any>;

async function importTransformers(): Promise<any> {
  try {
    const req = createRequire(__filename);
    const cjsPath = req.resolve('@huggingface/transformers');
    const mjsPath = join(dirname(cjsPath), 'transformers.node.mjs');
    if (existsSync(mjsPath)) {
      return await dynamicImport(pathToFileURL(mjsPath).href);
    }
  } catch {
    // fall through to bare import
  }
  return await import('@huggingface/transformers');
}

interface LidTokens {
  sot: number;
  zh: number;
  en: number;
}

export class WhisperEngine implements AsrEngine {
  private lidTokens: LidTokens | null = null;

  private constructor(
    private readonly pipe: any,
    private readonly TensorCls: any,
    public readonly ep: string,
    public readonly loadMs: number,
    public warmMs = 0,
  ) {
    this.lidTokens = this.resolveLidTokens();
  }

  /**
   * Find <|startoftranscript|>/<|zh|>/<|en|> token ids by scanning the
   * special-token id range (stable for large-v3 family, but resolved at
   * runtime so a different vocab just disables LID instead of misrouting).
   */
  private resolveLidTokens(): LidTokens | null {
    try {
      const tok = this.pipe.tokenizer;
      const found: Record<string, number> = {};
      for (let id = 50256; id < 50380; id++) {
        const s = tok.decode([id], { skip_special_tokens: false });
        if (s === '<|startoftranscript|>' || s === '<|zh|>' || s === '<|en|>') found[s] = id;
      }
      if (
        found['<|startoftranscript|>'] === undefined ||
        found['<|zh|>'] === undefined ||
        found['<|en|>'] === undefined
      ) {
        console.warn('[engine] LID tokens not found in vocab — auto language disabled');
        return null;
      }
      return { sot: found['<|startoftranscript|>'], zh: found['<|zh|>'], en: found['<|en|>'] };
    } catch (e) {
      console.warn('[engine] LID token resolution failed:', (e as Error).message);
      return null;
    }
  }

  get lidAvailable(): boolean {
    return this.lidTokens !== null;
  }

  /**
   * Language identification: one decoder step from <|startoftranscript|>,
   * argmax over the <|zh|>/<|en|> language-token logits (whisper's native
   * detect_language, done by hand because transformers.js 3.8.1 lacks it).
   * Costs ~1 mel + 1 encoder pass + 1 decoder step (~250 ms on this box).
   */
  async detectZhEn(pcm: Float32Array): Promise<EngineLidResult | null> {
    const lid = this.lidTokens;
    if (!lid) return null;
    const t0 = Date.now();
    const { input_features } = await this.pipe.processor(pcm);
    const decoder_input_ids = new this.TensorCls(
      'int64',
      BigInt64Array.from([BigInt(lid.sot)]),
      [1, 1],
    );
    const out = await this.pipe.model({ input_features, decoder_input_ids });
    const logits = out.logits; // [1, 1, vocab]
    const data = logits.data;
    const isFp16 = logits.type === 'float16';
    const zh = isFp16 ? halfToFloat(Number(data[lid.zh])) : Number(data[lid.zh]);
    const en = isFp16 ? halfToFloat(Number(data[lid.en])) : Number(data[lid.en]);
    return {
      lang: zh >= en ? 'chinese' : 'english',
      margin: Math.abs(zh - en),
      lidMs: Date.now() - t0,
    };
  }

  static async load(init: EngineInit): Promise<WhisperEngine> {
    const t0 = Date.now();
    const mod = await importTransformers();
    const { pipeline, env } = mod;

    env.cacheDir = init.modelsDir;
    env.allowRemoteModels = false; // model files are local; never hit the network
    env.allowLocalModels = true;

    // transformers.js 3.8.1: EP selection is the `device` pipeline option
    // ('dml' supported on win32 node); env.backends tweaks do NOTHING.
    const wantDml = init.ep.includes('dml');
    const hasQ8 = existsSync(
      join(init.modelsDir, init.modelId, 'onnx', 'decoder_model_merged_quantized.onnx'),
    );
    const decoderDtype = hasQ8 ? 'q8' : 'fp16';
    const dtype = { encoder_model: 'fp16', decoder_model_merged: decoderDtype };

    const attempts: Array<{ label: string; device: Record<string, string> }> = [];
    if (wantDml) {
      attempts.push({
        label: `enc=dml/fp16 dec=cpu/${decoderDtype}`,
        device: { encoder_model: 'dml', decoder_model_merged: 'cpu' },
      });
    }
    attempts.push({
      label: `cpu-only (enc=fp16 dec=${decoderDtype})`,
      device: { encoder_model: 'cpu', decoder_model_merged: 'cpu' },
    });

    let lastErr: unknown;
    for (const att of attempts) {
      try {
        const pipe = await pipeline('automatic-speech-recognition', init.modelId, {
          dtype,
          device: att.device,
          session_options: { intraOpNumThreads: DECODER_THREADS },
        });
        return new WhisperEngine(pipe, mod.Tensor, att.label, Date.now() - t0);
      } catch (e) {
        lastErr = e;
        console.warn(`[engine] load (${att.label}) failed: ${(e as Error).message}`);
      }
    }
    throw lastErr;
  }

  /**
   * Warm BOTH inference paths with realistic input so the first user
   * sentence doesn't pay the cold-start tail: a 3 s full transcription
   * (mel + DML encoder + q8 decoder loop) plus one LID forward.
   */
  async warmup(): Promise<number> {
    const audio = new Float32Array(48000); // 3 s
    for (let i = 0; i < audio.length; i++) {
      audio[i] =
        0.05 * Math.sin((2 * Math.PI * 220 * i) / 16000) +
        0.03 * Math.sin((2 * Math.PI * 470 * i) / 16000);
    }
    const t0 = Date.now();
    await this.transcribe(audio, 'chinese');
    await this.detectZhEn(audio).catch(() => null);
    this.warmMs = Date.now() - t0;
    return this.warmMs;
  }

  /**
   * Transcribe one VAD-endpointed utterance (whole segment, PLAN §6).
   *
   * `language` must be EXPLICIT ('chinese'/'english'/...): transformers.js
   * 3.8.1 has NO auto-detection — unset language FORCES English and
   * mistranslates Chinese speech (measured). 'auto' routing lives in the
   * worker (LanguageRouter + detectZhEn); 'chinese' is the defensive default.
   */
  async transcribe(pcm: Float32Array, language: 'auto' | string): Promise<TranscribeResult> {
    const opts: Record<string, unknown> = {
      task: 'transcribe',
      chunk_length_s: 30,
      language: language === 'auto' ? 'chinese' : language,
    };

    const t0 = Date.now();
    console.log(`[engine] pipe() enter (${pcm.length} samples)`);
    const r = await this.pipe(pcm, opts);
    console.log(`[engine] pipe() exit ${Date.now() - t0}ms`);
    const inferMs = Date.now() - t0;

    const text = typeof r?.text === 'string' ? r.text.trim() : '';
    const lang: string | undefined = r?.chunks?.[0]?.language ?? r?.language ?? undefined;
    return { text, lang, inferMs };
  }
}

/**
 * Filter obvious non-speech outputs. Whisper hallucinates boilerplate on
 * near-silence/noise — the denylist covers the classic zh/en offenders
 * (OpenCluely shipped the same guard for the same reason).
 */
const HALLUCINATION_RE =
  /^(谢谢(观看|大家|收看)|请(不吝)?点赞|订阅|转发|打赏|字幕由.*(提供|制作)|字幕提供|(明镜|点点)栏目|thank you( so much)? for watching|thanks for watching|please (like and )?subscribe|subtitles? by)/i;

export function isJunkTranscript(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (/^[\s.。,，!！?？~〜\-–—·]*$/.test(t)) return true;
  if (HALLUCINATION_RE.test(t.replace(/^[\s"'“”]+/, ''))) return true;
  return false;
}
