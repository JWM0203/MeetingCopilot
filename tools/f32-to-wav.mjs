/**
 * Convert raw 16 kHz mono float32 PCM (.f32) to a 16-bit WAV for playback.
 * Usage: node tools/f32-to-wav.mjs <in.f32> <out.wav>
 */
import { readFileSync, writeFileSync } from 'fs';

const [inPath, outPath] = process.argv.slice(2);
if (!inPath || !outPath) {
  console.error('usage: node tools/f32-to-wav.mjs <in.f32> <out.wav>');
  process.exit(1);
}

const SR = 16000;
const buf = readFileSync(inPath);
const f32 = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
const pcm16 = new Int16Array(f32.length);
for (let i = 0; i < f32.length; i++) {
  const s = Math.max(-1, Math.min(1, f32[i]));
  pcm16[i] = Math.round(s * 32767);
}

const dataLen = pcm16.length * 2;
const header = Buffer.alloc(44);
header.write('RIFF', 0);
header.writeUInt32LE(36 + dataLen, 4);
header.write('WAVE', 8);
header.write('fmt ', 12);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20); // PCM
header.writeUInt16LE(1, 22); // mono
header.writeUInt32LE(SR, 24);
header.writeUInt32LE(SR * 2, 28);
header.writeUInt16LE(2, 32);
header.writeUInt16LE(16, 34);
header.write('data', 36);
header.writeUInt32LE(dataLen, 40);

writeFileSync(outPath, Buffer.concat([header, Buffer.from(pcm16.buffer)]));
console.log(`wrote ${outPath} (${(f32.length / SR).toFixed(1)}s)`);
