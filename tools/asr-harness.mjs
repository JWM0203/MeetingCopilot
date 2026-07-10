/**
 * ASR acceptance harness (PLAN §7.3): load turbo fp16 + cache_position patch,
 * transcribe the real Chinese fixture, assert non-empty output, print timings.
 *
 * Usage:
 *   node tools/asr-harness.mjs           # DirectML GPU (default)
 *   node tools/asr-harness.mjs --cpu     # CPU EP (CI / correctness only)
 */
import { readFileSync, existsSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { createRequire } from 'module';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '..');
const useCpu = process.argv.includes('--cpu');

const MODELS_DIR =
  process.env.MC_MODELS_DIR ?? join(process.env.APPDATA, 'MeetingCopilot', 'models');
const MODEL_ID = 'onnx-community/whisper-large-v3-turbo-ONNX';
const FIXTURE = join(projectRoot, 'test', 'fixtures', 'zh_16k.f32');

function fail(msg) {
  console.error(`HARNESS_FAIL: ${msg}`);
  process.exit(1);
}

if (!existsSync(join(MODELS_DIR, MODEL_ID, 'onnx', 'encoder_model_fp16.onnx'))) {
  fail(`model files missing under ${join(MODELS_DIR, MODEL_ID)}`);
}
if (!existsSync(FIXTURE)) fail(`fixture missing: ${FIXTURE}`);

// Load the patched node ESM build explicitly (same path the app worker uses).
const require_ = createRequire(import.meta.url);
const cjsPath = require_.resolve('@huggingface/transformers');
const mjsPath = join(dirname(cjsPath), 'transformers.node.mjs');
const { pipeline, env } = await import(pathToFileURL(mjsPath).href);

env.cacheDir = MODELS_DIR;
env.allowRemoteModels = false;
env.allowLocalModels = true;
// Winning config (see electron/asr/engine.ts): encoder fp16 on DML,
// decoder q8 on CPU. Decoder fp16 ON DML produces garbage logits.
const hasQ8 = existsSync(
  join(MODELS_DIR, MODEL_ID, 'onnx', 'decoder_model_merged_quantized.onnx'),
);
const dtype = { encoder_model: 'fp16', decoder_model_merged: hasQ8 ? 'q8' : 'fp16' };
const device = useCpu
  ? { encoder_model: 'cpu', decoder_model_merged: 'cpu' }
  : { encoder_model: 'dml', decoder_model_merged: 'cpu' };

console.log(`device=${JSON.stringify(device)} dtype=${JSON.stringify(dtype)}`);

let t = Date.now();
const pipe = await pipeline('automatic-speech-recognition', MODEL_ID, {
  dtype,
  device,
  session_options: { intraOpNumThreads: 6 },
});
const loadMs = Date.now() - t;
console.log(`load: ${loadMs}ms`);

// warmup (GPU kernel compile etc.)
const warm = new Float32Array(8000);
for (let i = 0; i < warm.length; i++) warm[i] = 0.05 * Math.sin((2 * Math.PI * 440 * i) / 16000);
t = Date.now();
await pipe(warm, { task: 'transcribe', language: 'english' });
const warmMs = Date.now() - t;
console.log(`warmup(0.5s audio): ${warmMs}ms`);

// real Chinese fixture
const buf = readFileSync(FIXTURE);
const audio = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
const audioSec = audio.length / 16000;
console.log(`fixture: ${audioSec.toFixed(1)}s Chinese speech`);

t = Date.now();
const r = await pipe(audio, { task: 'transcribe', language: 'chinese', chunk_length_s: 30 });
const inferMs = Date.now() - t;

const text = (r?.text ?? '').trim();
console.log(`zh infer: ${inferMs}ms  RTF=${(inferMs / 1000 / audioSec).toFixed(3)}`);
console.log(`zh text: ${text}`);

if (!text) fail('empty transcription');
if (!/[一-鿿]/.test(text)) fail(`no Chinese characters in output: ${text}`);
if (!text.includes('核心产品')) fail(`expected substring 核心产品 missing: ${text}`);
if (!useCpu && inferMs > 4000) {
  console.warn('HARNESS_WARN: inference slower than expected — DML/q8 config may be off');
}

// ---- LID gate: one decoder step, argmax over <|zh|>/<|en|> logits ----
const { Tensor } = await import(pathToFileURL(mjsPath).href);
const tok = pipe.tokenizer;
const ids = {};
for (let id = 50256; id < 50380; id++) {
  const s = tok.decode([id], { skip_special_tokens: false });
  if (s === '<|startoftranscript|>' || s === '<|zh|>' || s === '<|en|>') ids[s] = id;
}
if (ids['<|zh|>'] === undefined) fail('LID tokens not found in vocab');

async function lid(pcm) {
  const { input_features } = await pipe.processor(pcm);
  const decoder_input_ids = new Tensor(
    'int64',
    BigInt64Array.from([BigInt(ids['<|startoftranscript|>'])]),
    [1, 1],
  );
  const out = await pipe.model({ input_features, decoder_input_ids });
  const d = out.logits.data;
  const zh = Number(d[ids['<|zh|>']]);
  const en = Number(d[ids['<|en|>']]);
  return { lang: zh >= en ? 'zh' : 'en', margin: Math.abs(zh - en) };
}

t = Date.now();
const zhLid = await lid(audio);
console.log(`LID(zh fixture): ${zhLid.lang} margin=${zhLid.margin.toFixed(2)} ${Date.now() - t}ms`);
if (zhLid.lang !== 'zh') fail('LID misdetected the Chinese fixture');

const enBuf = readFileSync(join(projectRoot, 'test', 'fixtures', 'en_test.f32'));
const enAudio = new Float32Array(enBuf.buffer, enBuf.byteOffset, enBuf.byteLength / 4);
t = Date.now();
const enLid = await lid(enAudio);
console.log(`LID(en fixture): ${enLid.lang} margin=${enLid.margin.toFixed(2)} ${Date.now() - t}ms`);
if (enLid.lang !== 'en') fail('LID misdetected the English fixture');

t = Date.now();
const er = await pipe(enAudio, { task: 'transcribe', language: 'english', chunk_length_s: 30 });
const enText = (er?.text ?? '').trim();
console.log(`en infer: ${Date.now() - t}ms`);
console.log(`en text: ${enText}`);
if (!/products|advantages|artificial/i.test(enText)) {
  fail(`English transcription missing expected words: ${enText}`);
}
console.log('HARNESS_OK');
