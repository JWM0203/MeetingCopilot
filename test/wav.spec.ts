import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { encodeWav } from '../electron/asr/wav';
import { decodeWav, decodeWav16kMono } from '../electron/asr/wavRead';

function readHeader(buf: Uint8Array) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const str = (o: number, n: number) =>
    String.fromCharCode(...Array.from({ length: n }, (_, i) => dv.getUint8(o + i)));
  return {
    riff: str(0, 4),
    wave: str(8, 4),
    fmt: str(12, 4),
    format: dv.getUint16(20, true),
    channels: dv.getUint16(22, true),
    sampleRate: dv.getUint32(24, true),
    bits: dv.getUint16(34, true),
    data: str(36, 4),
    dataLen: dv.getUint32(40, true),
  };
}

describe('encodeWav', () => {
  it('writes a valid 16 kHz mono 16-bit PCM header', () => {
    const pcm = new Float32Array(1600); // 0.1 s
    const wav = encodeWav(pcm, 16000);
    const h = readHeader(wav);
    expect(h.riff).toBe('RIFF');
    expect(h.wave).toBe('WAVE');
    expect(h.fmt).toBe('fmt ');
    expect(h.format).toBe(1);
    expect(h.channels).toBe(1);
    expect(h.sampleRate).toBe(16000);
    expect(h.bits).toBe(16);
    expect(h.data).toBe('data');
    expect(h.dataLen).toBe(1600 * 2);
    expect(wav.length).toBe(44 + 1600 * 2);
  });

  it('quantizes float samples to int16 and clamps out-of-range', () => {
    const pcm = new Float32Array([0, 1, -1, 0.5, 2, -2]);
    const wav = encodeWav(pcm, 16000);
    const dv = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    expect(dv.getInt16(44, true)).toBe(0);
    expect(dv.getInt16(46, true)).toBe(32767); // +1 -> max
    expect(dv.getInt16(48, true)).toBe(-32768); // -1 -> min
    expect(dv.getInt16(50, true)).toBeCloseTo(16383, -1); // 0.5
    expect(dv.getInt16(52, true)).toBe(32767); // +2 clamped
    expect(dv.getInt16(54, true)).toBe(-32768); // -2 clamped
  });
});

describe('decodeWav', () => {
  it('round-trips encodeWav output', () => {
    const pcm = new Float32Array([0, 0.5, -0.5, 0.25]);
    const { pcm: back, sampleRate, channels } = decodeWav(encodeWav(pcm, 16000));
    expect(sampleRate).toBe(16000);
    expect(channels).toBe(1);
    expect(back.length).toBe(pcm.length);
    for (let i = 0; i < pcm.length; i++) expect(back[i]).toBeCloseTo(pcm[i], 3);
  });

  it('walks the chunk list instead of assuming a 44-byte header', () => {
    // SAPI (which generated the bundled fixtures) writes a `fact` chunk
    // between `fmt ` and `data`
    const body = encodeWav(new Float32Array([0.5, -0.5]), 16000);
    const fact = Buffer.alloc(12);
    fact.write('fact', 0, 'ascii');
    fact.writeUInt32LE(4, 4);
    fact.writeUInt32LE(2, 8);
    const withFact = Buffer.concat([
      Buffer.from(body.subarray(0, 36)),
      fact,
      Buffer.from(body.subarray(36)),
    ]);
    withFact.writeUInt32LE(withFact.length - 8, 4); // fix the RIFF size
    const { pcm } = decodeWav(withFact);
    expect(pcm.length).toBe(2);
    expect(pcm[0]).toBeCloseTo(0.5, 3);
  });

  it('rejects anything that is not a 16-bit RIFF/WAVE file', () => {
    expect(() => decodeWav(Buffer.alloc(64))).toThrow(/RIFF/);
  });

  it('refuses to guess when the format is not 16 kHz mono', () => {
    expect(() => decodeWav16kMono(encodeWav(new Float32Array(8), 44100))).toThrow(/16 kHz mono/);
  });
});

describe('bundled connection-test clips', () => {
  const clip = (name: string) =>
    readFileSync(join(__dirname, '..', 'resources', 'test-audio', name));

  for (const name of ['asr-test-zh.wav', 'asr-test-en.wav']) {
    it(`${name} ships as a short 16 kHz mono clip`, () => {
      const bytes = clip(name);
      // small enough to bundle, long enough for an ASR service to answer
      expect(bytes.length).toBeLessThanOrEqual(64 * 1024);
      const pcm = decodeWav16kMono(bytes);
      const seconds = pcm.length / 16000;
      expect(seconds).toBeGreaterThan(0.4);
      expect(seconds).toBeLessThan(3);
      // it must actually contain speech, not silence
      expect(Math.max(...pcm)).toBeGreaterThan(0.05);
    });
  }
});
