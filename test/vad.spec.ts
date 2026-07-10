import { describe, expect, it } from 'vitest';
import { VadSegmenter, rms } from '../electron/asr/vad';

const SR = 16000;
const FRAME_MS = 100;
const FRAME_LEN = (SR * FRAME_MS) / 1000;

function silenceFrame(): Float32Array {
  return new Float32Array(FRAME_LEN); // digital zero, like idle loopback
}

function speechFrame(amp = 0.1): Float32Array {
  const f = new Float32Array(FRAME_LEN);
  for (let i = 0; i < f.length; i++) f[i] = amp * Math.sin((2 * Math.PI * 300 * i) / SR);
  return f;
}

function feed(
  seg: VadSegmenter,
  frames: ('s' | '.')[],
  startTs = 1_000_000,
): ReturnType<VadSegmenter['push']> {
  const events: ReturnType<VadSegmenter['push']> = [];
  let ts = startTs;
  for (const f of frames) {
    ts += FRAME_MS;
    events.push(...seg.push(f === 's' ? speechFrame() : silenceFrame(), ts));
  }
  return events;
}

describe('rms', () => {
  it('is 0 for silence and ~amp/sqrt2 for a sine', () => {
    expect(rms(silenceFrame())).toBe(0);
    expect(rms(speechFrame(0.1))).toBeGreaterThan(0.06);
    expect(rms(speechFrame(0.1))).toBeLessThan(0.08);
  });
});

describe('VadSegmenter', () => {
  it('emits speech-start on first energetic frame', () => {
    const seg = new VadSegmenter();
    const events = feed(seg, ['.', '.', 's']);
    expect(events.map((e) => e.type)).toEqual(['speech-start']);
    expect(seg.state).toBe('speech');
  });

  it('closes a segment after hangover silence (300ms = 3 frames)', () => {
    const seg = new VadSegmenter();
    const events = feed(seg, ['s', 's', 's', 's', 's', '.', '.', '.']);
    const segs = events.filter((e) => e.type === 'segment');
    expect(segs).toHaveLength(1);
    const s = segs[0] as Extract<(typeof segs)[number], { type: 'segment' }>;
    expect(s.reason).toBe('silence');
    // 500ms speech + 300ms trailing silence recorded in the buffer
    expect(s.pcm.length).toBeGreaterThanOrEqual(5 * FRAME_LEN);
    expect(seg.state).toBe('idle');
  });

  it('drops segments shorter than minSpeechMs', () => {
    const seg = new VadSegmenter({ minSpeechMs: 250 });
    // single 100ms speech frame -> too short
    const events = feed(seg, ['.', 's', '.', '.', '.', '.']);
    expect(events.filter((e) => e.type === 'segment')).toHaveLength(0);
    expect(seg.state).toBe('idle');
  });

  it('hard-caps overlong speech at maxSegmentMs and keeps going', () => {
    const seg = new VadSegmenter({ maxSegmentMs: 1000 }); // 10 frames
    const events = feed(seg, Array(25).fill('s') as 's'[]);
    const segs = events.filter((e) => e.type === 'segment');
    expect(segs.length).toBeGreaterThanOrEqual(2);
    expect((segs[0] as { reason: string }).reason).toBe('maxlen');
    expect(seg.state).toBe('speech'); // still talking
  });

  it('includes pre-roll audio before speech onset', () => {
    const seg = new VadSegmenter({ preRollMs: 200 });
    const events = feed(seg, ['.', '.', '.', 's', 's', 's', '.', '.', '.']);
    const s = events.find((e) => e.type === 'segment') as { pcm: Float32Array } | undefined;
    expect(s).toBeDefined();
    // 300ms speech + 300ms hangover + ~200ms pre-roll
    expect(s!.pcm.length).toBeGreaterThanOrEqual(7 * FRAME_LEN);
  });

  it('flush() force-closes an open segment', () => {
    const seg = new VadSegmenter();
    feed(seg, ['s', 's', 's']);
    const events = seg.flush();
    expect(events).toHaveLength(1);
    expect((events[0] as { reason: string }).reason).toBe('flush');
    expect(seg.state).toBe('idle');
  });

  it('flush() on idle is a no-op', () => {
    const seg = new VadSegmenter();
    expect(seg.flush()).toHaveLength(0);
  });

  it('emits live partials while speaking when enabled', () => {
    const seg = new VadSegmenter({ partialIntervalMs: 300 }); // every 3 frames
    // 10 continuous speech frames (1000ms) => partials at ~300/600/900ms
    const events = feed(seg, Array(10).fill('s') as 's'[]);
    const partials = events.filter((e) => e.type === 'partial');
    expect(partials.length).toBeGreaterThanOrEqual(2);
    // each partial carries growing audio and no final yet
    const p0 = partials[0] as Extract<(typeof partials)[number], { type: 'partial' }>;
    expect(p0.pcm.length).toBeGreaterThan(0);
    expect(events.some((e) => e.type === 'segment')).toBe(false);
  });

  it('does not emit partials when disabled (interval 0, default)', () => {
    const seg = new VadSegmenter();
    const events = feed(seg, Array(10).fill('s') as 's'[]);
    expect(events.some((e) => e.type === 'partial')).toBe(false);
  });

  it('reports correct start/end timestamps', () => {
    const seg = new VadSegmenter();
    const t0 = 1_000_000;
    // 2 silence, 4 speech, 3 silence
    const events = feed(seg, ['.', '.', 's', 's', 's', 's', '.', '.', '.'], t0);
    const s = events.find((e) => e.type === 'segment') as
      | { startTs: number; endTs: number }
      | undefined;
    expect(s).toBeDefined();
    // speech frames are #3..#6 (ts = t0+300 .. t0+600)
    expect(s!.startTs).toBe(t0 + 300 - FRAME_MS);
    expect(s!.endTs).toBe(t0 + 600);
  });
});
