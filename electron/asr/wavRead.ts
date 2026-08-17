/**
 * Minimal RIFF/WAVE reader — the inverse of {@link encodeWav}.
 *
 * Only used to load the bundled connection-test clips
 * (`resources/test-audio/*.wav`), which is why it is deliberately strict:
 * 16 kHz mono 16-bit PCM or nothing. A silent resample would turn a broken
 * fixture into a mysterious ASR failure instead of a loud one.
 *
 * Pure (no fs, no electron) so it is unit-testable; the caller supplies the
 * bytes. Logic adapted from tools/wav-to-f32.mjs.
 */

export interface DecodedWav {
  /** float32 in [-1, 1] */
  pcm: Float32Array;
  sampleRate: number;
  channels: number;
}

/**
 * Decode a 16-bit PCM WAV. Walks the chunk list rather than assuming a 44-byte
 * header — SAPI (which generated our fixtures) emits a `fact` chunk first.
 */
export function decodeWav(bytes: Uint8Array): DecodedWav {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (off: number): string =>
    String.fromCharCode(
      view.getUint8(off),
      view.getUint8(off + 1),
      view.getUint8(off + 2),
      view.getUint8(off + 3),
    );

  if (bytes.byteLength < 44 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') {
    throw new Error('not a RIFF/WAVE file');
  }

  let channels = 0;
  let sampleRate = 0;
  let bits = 0;
  let dataOff = -1;
  let dataLen = 0;

  let off = 12;
  while (off + 8 <= bytes.byteLength) {
    const id = tag(off);
    const size = view.getUint32(off + 4, true);
    const body = off + 8;
    if (id === 'fmt ') {
      channels = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bits = view.getUint16(body + 14, true);
    } else if (id === 'data') {
      dataOff = body;
      // a streamed writer may leave the declared size larger than the file
      dataLen = Math.min(size, bytes.byteLength - body);
      break;
    }
    off = body + size + (size % 2);
  }

  if (dataOff < 0) throw new Error('WAV has no data chunk');
  if (bits !== 16) throw new Error(`WAV must be 16-bit PCM (got ${bits}-bit)`);

  const n = Math.floor(dataLen / 2);
  const pcm = new Float32Array(n);
  for (let i = 0; i < n; i++) pcm[i] = view.getInt16(dataOff + i * 2, true) / 32768;
  return { pcm, sampleRate, channels };
}

/** Decode and insist on the format the ASR engines take: 16 kHz mono. */
export function decodeWav16kMono(bytes: Uint8Array): Float32Array {
  const { pcm, sampleRate, channels } = decodeWav(bytes);
  if (sampleRate !== 16000 || channels !== 1) {
    throw new Error(`expected 16 kHz mono WAV, got ${sampleRate} Hz ${channels}ch`);
  }
  return pcm;
}
