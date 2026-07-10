/**
 * VAD-endpointed sentence segmentation (pure logic, unit-tested).
 *
 * MVP: adaptive energy VAD. System-loopback audio is digitally clean (true
 * silence between speech), so RMS + adaptive noise floor is reliable enough.
 * A Silero-VAD probability provider can replace `isSpeechFrame` later without
 * touching the segmenter state machine.
 *
 * Strategy (PLAN §6): ring-buffer PCM; speech starts on an energetic frame;
 * on >= hangoverMs of trailing silence (or maxSegmentMs hard cap) close the
 * segment and hand the WHOLE utterance to Whisper once.
 */

export interface VadOptions {
  sampleRate: number;
  /** trailing silence that closes a segment */
  hangoverMs: number;
  /** segments shorter than this are dropped (clicks, pops) */
  minSpeechMs: number;
  /** hard cap: close even while speech continues */
  maxSegmentMs: number;
  /** audio kept from before speech onset */
  preRollMs: number;
  /** absolute RMS floor below which a frame is never speech */
  absSilenceRms: number;
  /** frame is speech when rms > max(absSilenceRms, noiseFloor * ratio) */
  noiseRatio: number;
  /** emit a live partial every this many ms of open speech (0 = disabled) */
  partialIntervalMs: number;
}

export const DEFAULT_VAD_OPTIONS: VadOptions = {
  sampleRate: 16000,
  hangoverMs: 300,
  minSpeechMs: 250,
  // lower cap so a long monologue still finalizes within 10 s even w/o partials
  maxSegmentMs: 10000,
  // 300 ms pre-roll guards the first syllable (OpenCluely uses the same)
  preRollMs: 300,
  absSilenceRms: 0.004,
  noiseRatio: 3,
  partialIntervalMs: 0,
};

export type VadEvent =
  | { type: 'speech-start'; ts: number }
  | { type: 'partial'; pcm: Float32Array; startTs: number }
  | {
      type: 'segment';
      pcm: Float32Array;
      /** Date.now() of first/last speech sample */
      startTs: number;
      endTs: number;
      reason: 'silence' | 'maxlen' | 'flush';
    };

export function rms(frame: Float32Array): number {
  if (frame.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
  return Math.sqrt(sum / frame.length);
}

interface Chunk {
  pcm: Float32Array;
  ts: number; // capture ts of the chunk's LAST sample
  ms: number;
}

export class VadSegmenter {
  private opts: VadOptions;
  private inSpeech = false;
  private silenceMs = 0;
  private speechMs = 0;
  private segStartTs = 0;
  private lastSpeechTs = 0;
  private lastPartialAtMs = 0;
  private seg: Chunk[] = [];
  private preRoll: Chunk[] = [];
  private preRollMsHeld = 0;
  private noiseFloor: number;

  constructor(opts: Partial<VadOptions> = {}) {
    this.opts = { ...DEFAULT_VAD_OPTIONS, ...opts };
    this.noiseFloor = this.opts.absSilenceRms;
  }

  get state(): 'idle' | 'speech' {
    return this.inSpeech ? 'speech' : 'idle';
  }

  /** Enable/disable live partials at runtime (0 = off). */
  setPartialInterval(ms: number): void {
    this.opts = { ...this.opts, partialIntervalMs: ms };
  }

  private concatSeg(): Float32Array {
    const total = this.seg.reduce((a, c) => a + c.pcm.length, 0);
    const pcm = new Float32Array(total);
    let off = 0;
    for (const c of this.seg) {
      pcm.set(c.pcm, off);
      off += c.pcm.length;
    }
    return pcm;
  }

  /**
   * Push one PCM frame (any length; typically ~100 ms).
   * @param captureTs Date.now() at the frame's last sample.
   */
  push(pcm: Float32Array, captureTs: number): VadEvent[] {
    const o = this.opts;
    const frameMs = (pcm.length / o.sampleRate) * 1000;
    const level = rms(pcm);
    const events: VadEvent[] = [];

    const threshold = Math.max(o.absSilenceRms, this.noiseFloor * o.noiseRatio);
    const speechy = level > threshold;

    // adaptive noise floor: follow quiet levels fast, rise very slowly
    if (!speechy) {
      this.noiseFloor = Math.min(this.noiseFloor * 1.02, Math.max(level, o.absSilenceRms / 4));
      if (level < this.noiseFloor) this.noiseFloor = level;
    }

    const chunk: Chunk = { pcm, ts: captureTs, ms: frameMs };

    if (!this.inSpeech) {
      if (speechy) {
        this.inSpeech = true;
        this.silenceMs = 0;
        this.speechMs = frameMs;
        this.segStartTs = captureTs - frameMs;
        this.lastSpeechTs = captureTs;
        this.seg = [...this.preRoll, chunk];
        events.push({ type: 'speech-start', ts: captureTs - frameMs });
      } else {
        this.preRoll.push(chunk);
        this.preRollMsHeld += frameMs;
        while (this.preRollMsHeld > o.preRollMs && this.preRoll.length > 1) {
          this.preRollMsHeld -= this.preRoll[0].ms;
          this.preRoll.shift();
        }
      }
      return events;
    }

    // in speech
    this.seg.push(chunk);
    if (speechy) {
      this.silenceMs = 0;
      this.speechMs += frameMs;
      this.lastSpeechTs = captureTs;
    } else {
      this.silenceMs += frameMs;
    }

    const segMs = this.seg.reduce((a, c) => a + c.ms, 0);
    if (this.silenceMs >= o.hangoverMs) {
      const ev = this.close('silence');
      if (ev) events.push(ev);
    } else if (segMs >= o.maxSegmentMs) {
      const ev = this.close('maxlen');
      if (ev) events.push(ev);
    } else if (o.partialIntervalMs > 0 && segMs - this.lastPartialAtMs >= o.partialIntervalMs) {
      // live partial: transcribe the open segment so far (only on actual speech,
      // not while trailing silence accrues)
      this.lastPartialAtMs = segMs;
      if (speechy) events.push({ type: 'partial', pcm: this.concatSeg(), startTs: this.segStartTs });
    }
    return events;
  }

  /** Force-close any open segment (capture stopped). */
  flush(): VadEvent[] {
    if (!this.inSpeech) return [];
    const ev = this.close('flush');
    return ev ? [ev] : [];
  }

  private close(reason: 'silence' | 'maxlen' | 'flush'): VadEvent | null {
    const o = this.opts;
    const chunks = this.seg;
    const startTs = this.segStartTs;
    const endTs = this.lastSpeechTs;
    const speechMs = this.speechMs;

    this.inSpeech = false;
    this.silenceMs = 0;
    this.speechMs = 0;
    this.lastPartialAtMs = 0;
    this.seg = [];
    this.preRoll = [];
    this.preRollMsHeld = 0;

    if (speechMs < o.minSpeechMs) return null;

    const total = chunks.reduce((a, c) => a + c.pcm.length, 0);
    const pcm = new Float32Array(total);
    let off = 0;
    for (const c of chunks) {
      pcm.set(c.pcm, off);
      off += c.pcm.length;
    }
    return { type: 'segment', pcm, startTs, endTs, reason };
  }
}
