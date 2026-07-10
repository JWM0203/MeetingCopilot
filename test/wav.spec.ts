import { describe, expect, it } from 'vitest';
import { encodeWav } from '../electron/asr/wav';

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
