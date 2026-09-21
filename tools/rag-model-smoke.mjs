import { resolve } from 'node:path';

if (process.env.MC_RAG_MODEL_SMOKE !== '1') {
  console.log("Skipped. Run `$env:MC_RAG_MODEL_SMOKE='1'; npm run smoke:rag-model` to download and verify the local model.");
  process.exit(0);
}

const started = performance.now();
const { env, pipeline } = await import('@huggingface/transformers');
env.cacheDir = process.env.MC_RAG_MODEL_DIR || resolve('models/rag');
env.allowRemoteModels = true;
env.allowLocalModels = true;
const pipe = await pipeline('feature-extraction', 'Xenova/multilingual-e5-small', {
  revision: '761b726dd34fb83930e26aab4e9ac3899aa1fa78',
  dtype: 'q8',
});
const loadedMs = performance.now() - started;
const embedStarted = performance.now();
const output = await pipe(['query: 如何优化支付接口延迟？', 'query: How did you reduce payment latency?'], {
  pooling: 'mean',
  normalize: true,
});
const values = Float32Array.from(output.data);
if (values.length !== 768 || values.some((value) => !Number.isFinite(value))) {
  throw new Error(`Invalid embedding output: ${values.length} values`);
}
console.log(JSON.stringify({ dimensions: 384, vectors: 2, loadedMs, embedMs: performance.now() - embedStarted }));
