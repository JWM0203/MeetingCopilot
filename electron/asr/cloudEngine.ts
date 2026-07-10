/**
 * Cloud ASR engine (PLAN §6.5 "Plan B"): send each VAD-endpointed segment to
 * an OpenAI-compatible audio-in chat endpoint. Default = MiMo `mimo-v2.5-asr`
 * (China-direct, ~1.1 s for 10 s audio, auto language detection).
 *
 * Same interface as WhisperEngine so the worker swaps engines with no other
 * change. Runs in the utilityProcess (global fetch, direct — MiMo needs no
 * proxy). The local VAD stays the gate: only speech leaves the machine.
 */
import { encodeWav } from './wav';
import type { AsrEngine, TranscribeResult } from './engine';

export interface CloudAsrConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
}

export class CloudAsrEngine implements AsrEngine {
  readonly ep = 'cloud';
  readonly loadMs = 0;
  warmMs = 0;
  readonly lidAvailable = false;

  private constructor(private readonly cfg: CloudAsrConfig) {}

  static async load(cfg: CloudAsrConfig): Promise<CloudAsrEngine> {
    if (!cfg.baseUrl || !cfg.model || !cfg.apiKey) {
      throw new Error('云端 ASR 未配置（需要 Base URL / 模型 / API Key）');
    }
    return new CloudAsrEngine(cfg);
  }

  /** No GPU to warm; cloud is stateless per request. */
  async warmup(): Promise<number> {
    return 0;
  }

  async transcribe(pcm: Float32Array, _language: 'auto' | string): Promise<TranscribeResult> {
    const b64 = Buffer.from(encodeWav(pcm, 16000)).toString('base64');
    const url = `${this.cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`;
    const t0 = Date.now();
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.cfg.apiKey}` },
      body: JSON.stringify({
        model: this.cfg.model,
        messages: [{ role: 'user', content: [{ type: 'input_audio', input_audio: { data: b64, format: 'wav' } }] }],
        stream: false,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`cloud ASR HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
    const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = (j?.choices?.[0]?.message?.content ?? '').trim();
    return { text, lang: undefined, inferMs: Date.now() - t0 };
  }
}
