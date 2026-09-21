import { resolve } from 'node:path';

const OPT_IN = "$env:MC_RAG_BENCHMARK='1'; npm run benchmark:rag";
if (process.env.MC_RAG_BENCHMARK !== '1') {
  console.log(`Skipped. Run \`${OPT_IN}\` to benchmark the cached local RAG model.`);
  process.exit(0);
}

const MODEL_ID = 'Xenova/multilingual-e5-small';
const MODEL_REVISION = '761b726dd34fb83930e26aab4e9ac3899aa1fa78';
const DIMENSIONS = 384;
const CORPUS_SIZE = 400;
const QUERY_COUNT = 100;

const percentile = (values, fraction) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
};
const summary = (values) => ({
  p50: Number(percentile(values, 0.5).toFixed(2)),
  p95: Number(percentile(values, 0.95).toFixed(2)),
});

function terms(text) {
  const normalized = text.normalize('NFKC').toLowerCase();
  const latin = normalized.match(/[a-z0-9][a-z0-9_.+#/-]*/g) ?? [];
  const cjkRuns = normalized.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+/gu) ?? [];
  const cjk = [];
  for (const run of cjkRuns) {
    if (run.length === 1) cjk.push(run);
    else for (let index = 0; index < run.length - 1; index++) cjk.push(run.slice(index, index + 2));
  }
  return [...latin, ...cjk];
}

function lexicalSearch(query, corpus, limit = 24) {
  const wanted = new Set(terms(query));
  const ranked = [];
  for (let index = 0; index < corpus.length; index++) {
    let score = 0;
    for (const term of corpus[index].terms) if (wanted.has(term)) score += term.length > 2 ? 2 : 1;
    if (score) ranked.push({ index, score });
  }
  return ranked.sort((a, b) => b.score - a.score || a.index - b.index).slice(0, limit);
}

function denseSearch(query, matrix, rows, limit = 24) {
  const ranked = new Array(rows);
  for (let row = 0; row < rows; row++) {
    let score = 0;
    const offset = row * DIMENSIONS;
    for (let col = 0; col < DIMENSIONS; col++) score += query[col] * matrix[offset + col];
    ranked[row] = { index: row, score };
  }
  return ranked.sort((a, b) => b.score - a.score || a.index - b.index).slice(0, limit);
}

function fuse(lexical, dense) {
  const scores = new Map();
  for (const ranked of [lexical, dense]) {
    ranked.forEach((item, rank) => scores.set(item.index, (scores.get(item.index) ?? 0) + 1 / (61 + rank)));
  }
  return [...scores].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 6);
}

const corpus = Array.from({ length: CORPUS_SIZE }, (_, index) => {
  const domain = ['支付幂等', '实时转录', 'React 性能', '项目复盘'][index % 4];
  const text = `${domain} 项目资料 ${index}。I reduced P95 latency with batching, caching, and bounded concurrency. 通过监控、压测和降级保证系统稳定。`;
  return { text, terms: terms(text) };
});
const queries = Array.from(
  { length: QUERY_COUNT },
  (_, index) => ['如何保证支付幂等？', 'How did you reduce P95 latency?', '实时转录如何降级？', 'React 性能优化经验'][index % 4],
);

const modelStarted = performance.now();
const { env, pipeline } = await import('@huggingface/transformers');
env.cacheDir = process.env.MC_RAG_MODEL_DIR || resolve('models/rag');
env.allowRemoteModels = true;
env.allowLocalModels = true;
const embedder = await pipeline('feature-extraction', MODEL_ID, {
  revision: MODEL_REVISION,
  dtype: 'q8',
});
const modelLoadMs = performance.now() - modelStarted;

const indexStarted = performance.now();
const matrix = new Float32Array(CORPUS_SIZE * DIMENSIONS);
for (let offset = 0; offset < corpus.length; offset += 32) {
  const batch = corpus.slice(offset, offset + 32).map((item) => `passage: ${item.text}`);
  const output = await embedder(batch, { pooling: 'mean', normalize: true });
  matrix.set(Float32Array.from(output.data), offset * DIMENSIONS);
}
const indexingMs = performance.now() - indexStarted;

await embedder('query: warm up', { pooling: 'mean', normalize: true });
const embeddingMs = [];
const lexicalMs = [];
const denseMs = [];
const totalMs = [];
for (const query of queries) {
  const totalStarted = performance.now();
  const embeddingStarted = performance.now();
  const output = await embedder(`query: ${query}`, { pooling: 'mean', normalize: true });
  embeddingMs.push(performance.now() - embeddingStarted);

  const lexicalStarted = performance.now();
  const lexical = lexicalSearch(query, corpus);
  lexicalMs.push(performance.now() - lexicalStarted);

  const denseStarted = performance.now();
  const dense = denseSearch(Float32Array.from(output.data), matrix, corpus.length);
  denseMs.push(performance.now() - denseStarted);
  fuse(lexical, dense);
  totalMs.push(performance.now() - totalStarted);
}

const result = {
  model: { id: MODEL_ID, revision: MODEL_REVISION, loadMs: Number(modelLoadMs.toFixed(2)) },
  indexing: {
    chunks: CORPUS_SIZE,
    durationMs: Number(indexingMs.toFixed(2)),
    chunksPerSecond: Number((CORPUS_SIZE / (indexingMs / 1000)).toFixed(2)),
  },
  queryEmbeddingMs: summary(embeddingMs),
  denseMs: summary(denseMs),
  lexicalMs: summary(lexicalMs),
  totalMs: summary(totalMs),
};
console.log(JSON.stringify(result));
if (result.totalMs.p95 > 300) {
  console.error(`RAG benchmark failed: total P95 ${result.totalMs.p95} ms exceeds 300 ms.`);
  process.exit(1);
}
