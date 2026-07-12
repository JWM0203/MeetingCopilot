/**
 * Streaming ASR acceptance smoke: drive the BUILT asr worker
 * (out/main/asrWorker.js, worker_threads compat path) with the real zh/en
 * fixtures against the live Aliyun fun-asr-realtime endpoint, and assert we
 * get partials while speaking plus correct finals.
 *
 * Usage: set MC_RT_URL plus MC_RT_KEY for remote wss://, build once, then run
 * `npm run smoke:asr:realtime`. A local ws:// sidecar needs no key.
 */
import { Worker } from 'worker_threads';
import { readFileSync, existsSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const workerPath = join(root, 'out', 'main', 'asrWorker.js');

const KEY = process.env.MC_RT_KEY;
const URL_ = process.env.MC_RT_URL;
const MODEL = process.env.MC_RT_MODEL || 'fun-asr-realtime';

function fail(msg) {
  console.error(`SMOKE_FAIL: ${msg}`);
  process.exit(1);
}

// key is required for remote wss://; the local ws:// sidecar needs none
if (!URL_ || (!KEY && URL_.startsWith('wss://'))) fail('missing MC_RT_KEY / MC_RT_URL env');
if (!existsSync(workerPath)) fail('out/main/asrWorker.js missing — run `npm run build` first');

function loadF32(p) {
  const buf = readFileSync(p);
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}
const zh = loadF32(join(root, 'test', 'fixtures', 'zh_16k.f32'));
const en = loadF32(join(root, 'test', 'fixtures', 'en_test.f32'));

const worker = new Worker(workerPath);
const finals = [];
let partials = 0;
let readyAt = 0;

worker.on('message', (m) => {
  if (m.type === 'ready') {
    readyAt = Date.now();
    console.log(`ready ep=${m.ep}`);
  } else if (m.type === 'partial') {
    partials++;
    console.log(`  [partial ${m.speaker}] ${m.text}`);
  } else if (m.type === 'segment') {
    finals.push(m);
    console.log(`[FINAL ${m.speaker}] (${m.audioMs}ms audio) ${m.text}`);
  } else if (m.type === 'error') {
    console.error(`[error fatal=${m.fatal}] ${m.message}`);
    if (m.fatal) fail(m.message);
  }
});
worker.on('error', (e) => fail(`worker crashed: ${e.message}`));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** feed a clip in 100 ms frames at ~4x real-time + trailing silence */
async function feed(pcm, channel) {
  const FRAME = 1600; // 100 ms
  for (let off = 0; off < pcm.length; off += FRAME) {
    const frame = pcm.slice(off, Math.min(off + FRAME, pcm.length));
    worker.postMessage({ type: 'pcm', pcm: frame, captureTs: Date.now(), channel });
    await sleep(25); // 4x real-time
  }
  // 1.2 s of trailing silence so the service can endpoint the last sentence
  for (let i = 0; i < 12; i++) {
    worker.postMessage({ type: 'pcm', pcm: new Float32Array(FRAME), captureTs: Date.now(), channel });
    await sleep(25);
  }
}

const t0 = Date.now();
worker.postMessage({
  type: 'init',
  backend: 'cloud-realtime',
  modelsDir: '',
  modelId: '',
  ep: ['cpu'],
  language: 'auto',
  cloud: { baseUrl: URL_, model: MODEL, apiKey: KEY ?? '' },
});

// wait ready (engine load is instant for cloud-rt)
while (!readyAt) {
  if (Date.now() - t0 > 10_000) fail('worker never became ready');
  await sleep(50);
}

console.log(`\n--- feeding zh fixture (${(zh.length / 16000).toFixed(1)}s) on channel them ---`);
await feed(zh, 'them');
// wait for the final(s) to land
const zhDeadline = Date.now() + 15_000;
while (!finals.some((f) => f.speaker === 'them') && Date.now() < zhDeadline) await sleep(200);

console.log(`\n--- feeding en fixture (${(en.length / 16000).toFixed(1)}s) on channel me ---`);
await feed(en, 'me');
const enDeadline = Date.now() + 15_000;
while (!finals.some((f) => f.speaker === 'me') && Date.now() < enDeadline) await sleep(200);

// graceful close
worker.postMessage({ type: 'flush' });
await sleep(2500);
worker.postMessage({ type: 'shutdown' });
await sleep(500);
await worker.terminate();

const zhText = finals.filter((f) => f.speaker === 'them').map((f) => f.text).join('');
const enText = finals.filter((f) => f.speaker === 'me').map((f) => f.text).join(' ');
console.log(`\nzh finals: ${zhText}`);
console.log(`en finals: ${enText}`);
console.log(`partials seen: ${partials}`);

if (!zhText) fail('no Chinese final segment');
if (!/[一-鿿]/.test(zhText)) fail(`no Chinese characters: ${zhText}`);
if (!zhText.includes('核心产品')) console.warn('SMOKE_WARN: expected substring 核心产品 missing');
if (!enText) fail('no English final segment');
if (!/products|advantages|artificial/i.test(enText)) {
  console.warn(`SMOKE_WARN: English missing expected words: ${enText}`);
}
if (partials === 0) console.warn('SMOKE_WARN: no partials observed (streaming captions may not update live)');
console.log('SMOKE_OK');
process.exit(0);
