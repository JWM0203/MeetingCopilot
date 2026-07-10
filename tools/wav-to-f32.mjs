/**
 * Convert 16 kHz mono PCM16 WAV to raw float32 (.f32) fixture format.
 * Usage: node tools/wav-to-f32.mjs <in.wav> <out.f32>
 */
import { readFileSync, writeFileSync } from 'fs';

const [inPath, outPath] = process.argv.slice(2);
if (!inPath || !outPath) {
  console.error('usage: node tools/wav-to-f32.mjs <in.wav> <out.f32>');
  process.exit(1);
}

const buf = readFileSync(inPath);
if (buf.toString('ascii', 0, 4) !== 'RIFF') throw new Error('not a WAV file');
const channels = buf.readUInt16LE(22);
const sampleRate = buf.readUInt32LE(24);
const bits = buf.readUInt16LE(34);
if (channels !== 1 || sampleRate !== 16000 || bits !== 16) {
  throw new Error(`expected 16kHz mono 16-bit, got ${sampleRate}Hz ${channels}ch ${bits}bit`);
}
// find the data chunk (skip any LIST/fact chunks)
let off = 12;
let dataOff = -1;
let dataLen = 0;
while (off + 8 <= buf.length) {
  const id = buf.toString('ascii', off, off + 4);
  const len = buf.readUInt32LE(off + 4);
  if (id === 'data') {
    dataOff = off + 8;
    dataLen = len;
    break;
  }
  off += 8 + len + (len % 2);
}
if (dataOff < 0) throw new Error('no data chunk');

const n = Math.floor(dataLen / 2);
const f32 = new Float32Array(n);
for (let i = 0; i < n; i++) f32[i] = buf.readInt16LE(dataOff + i * 2) / 32768;
writeFileSync(outPath, Buffer.from(f32.buffer));
console.log(`wrote ${outPath} (${(n / 16000).toFixed(1)}s)`);
