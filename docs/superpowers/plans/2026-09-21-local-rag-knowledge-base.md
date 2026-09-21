# Local RAG Knowledge Base Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional, local, incrementally indexed hybrid RAG knowledge base that improves personalized interview answers without changing legacy behavior when RAG is disabled or unavailable.

**Architecture:** A dedicated Electron `utilityProcess` owns local multilingual embeddings, document shards, and hybrid retrieval. The main process applies a 250 ms retrieval deadline and injects only the selected chunks into the dynamic part of the existing prompt; the renderer manages the global folder, per-session scope, progress, errors, and answer references.

**Tech Stack:** Electron 41, React 19, TypeScript 5.8, Vitest 3, `@huggingface/transformers` 3.8.1, ONNX Runtime, existing PDF/DOCX/text parsers, filesystem JSON and Float32 shard files.

## Global Constraints

- RAG is disabled by default in both global settings and every existing or new session.
- When RAG is disabled, unavailable, empty, or late, answer generation follows the existing path and produces a byte-for-byte identical prompt.
- Parsing, chunking, embeddings, vector storage, and retrieval stay local; only retrieved chunks are sent to a configured remote LLM.
- The embedding model is a pinned quantized ONNX revision of `multilingual-e5-small`, downloaded on first enable and cached under Electron `userData`.
- Supported library inputs are PDF, DOCX, TXT, Markdown, and `.markdown`; image-only PDFs report a per-file error and do not block other files.
- Resume, JD, and rolling memo remain authoritative over retrieved library content.
- Retrieved context is added only to the dynamic request message so `buildStablePrefix` and DeepSeek prefix prewarming stay unchanged.
- Dense and lexical retrieval run in parallel, with a 250 ms soft deadline and a warm total retrieval P95 target of 300 ms on the reference development machine.
- Do not add a native vector database or approximate-nearest-neighbor dependency in this release.
- Index writes use temporary files plus atomic rename; schema/model mismatch rebuilds a versioned index instead of mutating incompatible data.
- Never log document bodies, chunks, embeddings, API keys, resume text, or JD text.
- Run all commands from the repository root on branch `feature/local-rag-knowledge-base`.

## File Map

- `shared/rag.ts`: renderer/main/worker-safe RAG types and constants.
- `electron/rag/chunker.ts`: deterministic semantic-boundary chunking and chunk hashing.
- `electron/rag/retrieval.ts`: lexical scoring, dense scoring, reciprocal-rank fusion, scope filtering, deduplication, and context packing.
- `electron/rag/store.ts`: versioned manifest and atomic per-document JSON/Float32 shards.
- `electron/rag/indexer.ts`: root scanning, document parsing, incremental updates, vector reuse, and committed snapshots.
- `electron/rag/contract.ts`: utility-process message protocol.
- `electron/rag/embedder.ts`: pinned Transformers.js model loading and normalized embeddings.
- `electron/rag/worker.ts`: utility-process request loop.
- `electron/ragHost.ts`: main-process host, request correlation, deadlines, restart, and status replay.
- `src/components/KnowledgeBaseSettings.tsx`: global RAG settings, progress, scan controls, and errors.
- `src/components/KnowledgeScopeDialog.tsx`: per-session searchable document/folder selection.
- Existing protocol, settings, prompt, main, preload, App, AnswerSession, i18n, diagnostics, styles, and build configuration are modified at their current boundaries rather than reorganized.

---

### Task 1: Pure Chunking and Hybrid Retrieval Primitives

**Files:**
- Create: `shared/rag.ts`
- Create: `electron/rag/chunker.ts`
- Create: `electron/rag/retrieval.ts`
- Create: `test/ragChunker.spec.ts`
- Create: `test/ragRetrieval.spec.ts`

**Interfaces:**
- Produces: `RagChunk`, `RagSourceRef`, `RagScope`, `RetrievedChunk`, `chunkDocument()`, `chunkHash()`, `lexicalSearch()`, `denseSearch()`, `fuseAndPack()`.
- Consumes: Node `crypto`; no Electron APIs and no model runtime.

- [x] **Step 1: Define shared immutable RAG types and constants**

Add exact exported contracts to `shared/rag.ts`:

```ts
export const RAG_SCHEMA_VERSION = 1;
export const RAG_MODEL_ID = 'Xenova/multilingual-e5-small';
export const RAG_MODEL_REVISION = '761b726dd34fb83930e26aab4e9ac3899aa1fa78';
export const RAG_QUERY_TIMEOUT_MS = 250;
export const RAG_CONTEXT_CHAR_BUDGET = 3600;

export interface RagScope {
  enabled: boolean;
  /** Empty means the entire indexed root. Values are root-relative POSIX paths. */
  includePaths?: string[];
}

export interface RagChunk {
  id: string;
  documentId: string;
  relativePath: string;
  title: string;
  text: string;
  ordinal: number;
  hash: string;
}

export interface RagSourceRef {
  chunkId: string;
  documentId: string;
  name: string;
  relativePath: string;
  score: number;
  excerpt?: string;
}

export interface RetrievedChunk {
  chunk: RagChunk;
  score: number;
}
```

- [x] **Step 2: Write failing deterministic chunking tests**

Add tests that require heading-aware chunks, bounded overlap, stable hashes, and no empty chunks:

```ts
it('keeps headings with their following paragraph and bounds chunk size', () => {
  const text = `# 项目经历\n\n实时面试助手。${'性能优化。'.repeat(180)}\n\n## 技术栈\n\nElectron React TypeScript`;
  const chunks = chunkDocument('doc-1', 'resume.md', text, { targetChars: 600, overlapChars: 80 });
  expect(chunks.length).toBeGreaterThan(1);
  expect(chunks[0].text).toContain('项目经历');
  expect(chunks.every((c) => c.text.trim().length > 0 && c.text.length <= 800)).toBe(true);
  expect(chunkDocument('doc-1', 'resume.md', text)).toEqual(chunkDocument('doc-1', 'resume.md', text));
});

it('hashes equal normalized content identically', () => {
  expect(chunkHash('hello\r\nworld  ')).toBe(chunkHash('hello\nworld'));
});
```

- [x] **Step 3: Run chunking tests and verify failure**

Run: `npx vitest run test/ragChunker.spec.ts`

Expected: FAIL because `electron/rag/chunker.ts` does not exist.

- [x] **Step 4: Implement deterministic chunking**

Implement paragraph/heading segmentation, split oversized paragraphs on sentence boundaries, add at most the configured overlap from the previous chunk, normalize CRLF/trailing whitespace, and derive `id` as `${documentId}:${ordinal}:${hash.slice(0, 12)}`. Keep the exported signature exact:

```ts
export function chunkDocument(
  documentId: string,
  relativePath: string,
  text: string,
  options: { targetChars?: number; overlapChars?: number } = {},
): RagChunk[];

export function chunkHash(text: string): string;
```

- [x] **Step 5: Write failing hybrid retrieval tests**

Cover Chinese n-grams, technical identifiers, dense ranking, scope filtering, duplicate suppression, per-document cap, and character budget:

```ts
it('combines semantic and exact technical-term matches', () => {
  const lexical = lexicalSearch('React 并发渲染 P95', chunks, 10);
  const dense = denseSearch(new Float32Array([1, 0]), matrix, chunks, 10);
  const packed = fuseAndPack({ lexical, dense, scope: { enabled: true }, charBudget: 900 });
  expect(packed.results[0].chunk.text).toContain('React');
  expect(packed.context.length).toBeLessThanOrEqual(900);
});

it('limits results to selected paths', () => {
  const packed = fuseAndPack({
    lexical: candidates,
    dense: [],
    scope: { enabled: true, includePaths: ['projects/payments'] },
    charBudget: 3600,
  });
  expect(packed.results.every((r) => r.chunk.relativePath.startsWith('projects/payments/'))).toBe(true);
});
```

- [x] **Step 6: Run retrieval tests and verify failure**

Run: `npx vitest run test/ragRetrieval.spec.ts`

Expected: FAIL because the retrieval exports do not exist.

- [x] **Step 7: Implement pure retrieval functions**

Use normalized Latin tokens plus overlapping CJK bigrams, pre-normalized dense dot products, reciprocal-rank fusion with `k=60`, a maximum of two chunks per document, duplicate rejection at Jaccard similarity `>= 0.85`, and a formatted context block. Export exact signatures:

```ts
export interface RankedCandidate { chunk: RagChunk; score: number }
export function lexicalSearch(query: string, chunks: readonly RagChunk[], limit: number): RankedCandidate[];
export function denseSearch(query: Float32Array, matrix: Float32Array, chunks: readonly RagChunk[], limit: number): RankedCandidate[];
export function fuseAndPack(input: {
  lexical: readonly RankedCandidate[];
  dense: readonly RankedCandidate[];
  scope: RagScope;
  charBudget?: number;
}): { results: RetrievedChunk[]; context: string };
```

- [x] **Step 8: Run the pure RAG tests**

Run: `npx vitest run test/ragChunker.spec.ts test/ragRetrieval.spec.ts`

Expected: PASS.

- [x] **Step 9: Commit Task 1**

```bash
git add shared/rag.ts electron/rag/chunker.ts electron/rag/retrieval.ts test/ragChunker.spec.ts test/ragRetrieval.spec.ts
git commit -m "feat: add local RAG retrieval primitives"
```

---

### Task 2: Atomic Shard Store and Incremental Indexer

**Files:**
- Create: `electron/rag/store.ts`
- Create: `electron/rag/indexer.ts`
- Create: `test/ragStore.spec.ts`
- Create: `test/ragIndexer.spec.ts`
- Reuse: `electron/docparse.ts`

**Interfaces:**
- Consumes: Task 1 `RagChunk`, `chunkDocument`, and `chunkHash`.
- Produces: `RagStore`, `RagIndexer`, `EmbeddingProvider`, `RagManifest`, `RagDocumentStatus`, and an immutable `IndexSnapshot`.

- [ ] **Step 1: Write failing shard round-trip and corruption tests**

Use a temporary directory and verify atomic persistence, float fidelity, schema mismatch rejection, and corrupt-shard isolation:

```ts
it('round-trips metadata and row-major float32 vectors', () => {
  const store = new RagStore(dir);
  store.writeDocument(doc, chunks, new Float32Array([1, 0, 0, 1]), 2);
  const loaded = store.loadDocument(doc.id);
  expect(loaded?.chunks).toEqual(chunks);
  expect([...loaded!.vectors]).toEqual([1, 0, 0, 1]);
  expect(loaded?.dimensions).toBe(2);
});

it('excludes a shard whose vector byte count does not match metadata', () => {
  writeFileSync(join(dir, 'shards', 'broken.f32'), Buffer.alloc(3));
  expect(new RagStore(dir).loadDocument('broken')).toBeNull();
});
```

- [ ] **Step 2: Run store tests and verify failure**

Run: `npx vitest run test/ragStore.spec.ts`

Expected: FAIL because `RagStore` does not exist.

- [ ] **Step 3: Implement the versioned atomic store**

Define and validate these persisted structures:

```ts
export interface RagManifest {
  schemaVersion: 1;
  modelId: string;
  modelRevision: string;
  dimensions: number;
  rootPath: string;
  updatedAt: string;
  documents: RagDocumentStatus[];
}

export class RagStore {
  constructor(readonly root: string) {}
  loadManifest(): RagManifest | null;
  writeManifest(manifest: RagManifest): void;
  loadDocument(documentId: string): StoredDocumentShard | null;
  writeDocument(meta: RagDocumentStatus, chunks: RagChunk[], vectors: Float32Array, dimensions: number): void;
  removeDocument(documentId: string): void;
  clear(): void;
}
```

Write `*.tmp`, flush and close file handles, then `renameSync`. Reject vector files where `byteLength !== chunkCount * dimensions * 4`.

- [ ] **Step 4: Write failing incremental indexer tests with a fake embedder**

The fake embedder records passage batches and returns deterministic two-dimensional normalized vectors. Verify initial indexing, unchanged rescans, one-file updates, deletes, parse failure isolation, and chunk-vector reuse:

```ts
const embedder: EmbeddingProvider = {
  dimensions: 2,
  embedPassages: vi.fn(async (texts) => new Float32Array(texts.flatMap((_, i) => [i % 2, (i + 1) % 2]))),
  embedQuery: vi.fn(async () => new Float32Array([1, 0])),
};

it('does not parse or embed unchanged documents twice', async () => {
  await indexer.scan(root);
  const calls = vi.mocked(embedder.embedPassages).mock.calls.length;
  await indexer.scan(root);
  expect(embedder.embedPassages).toHaveBeenCalledTimes(calls);
});
```

- [ ] **Step 5: Run indexer tests and verify failure**

Run: `npx vitest run test/ragIndexer.spec.ts`

Expected: FAIL because `RagIndexer` does not exist.

- [ ] **Step 6: Implement bounded incremental indexing**

Export exact injectable interfaces:

```ts
export interface EmbeddingProvider {
  readonly dimensions: number;
  embedPassages(texts: string[], signal?: AbortSignal): Promise<Float32Array>;
  embedQuery(text: string, signal?: AbortSignal): Promise<Float32Array>;
}

export interface IndexSnapshot {
  chunks: readonly RagChunk[];
  vectors: Float32Array;
  dimensions: number;
  documents: readonly RagDocumentStatus[];
}

export class RagIndexer {
  constructor(store: RagStore, embedder: EmbeddingProvider, parse: typeof extractDocText) {}
  load(rootPath: string): IndexSnapshot;
  scan(rootPath: string, signal?: AbortSignal, onProgress?: (p: RagProgress) => void): Promise<IndexSnapshot>;
  rebuild(rootPath: string, signal?: AbortSignal, onProgress?: (p: RagProgress) => void): Promise<IndexSnapshot>;
}
```

Ignore hidden entries, Office `~$` files, unsupported extensions, the active index directory, and symlinks resolving outside the root. Normalize stored relative paths to `/`. Limit parsing to two files concurrently and call `embedPassages` in batches of 16 chunks.

- [ ] **Step 7: Run store and indexer tests**

Run: `npx vitest run test/ragStore.spec.ts test/ragIndexer.spec.ts test/docparse.spec.ts`

Expected: PASS, including all pre-existing parser tests.

- [ ] **Step 8: Commit Task 2**

```bash
git add electron/rag/store.ts electron/rag/indexer.ts test/ragStore.spec.ts test/ragIndexer.spec.ts
git commit -m "feat: add incremental RAG document index"
```

---

### Task 3: Local Embedding Worker and Main-Process Host

**Files:**
- Create: `electron/rag/contract.ts`
- Create: `electron/rag/embedder.ts`
- Create: `electron/rag/worker.ts`
- Create: `electron/ragHost.ts`
- Create: `test/ragContract.spec.ts`
- Create: `tools/rag-model-smoke.mjs`
- Modify: `electron.vite.config.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: Task 2 `RagIndexer`, `EmbeddingProvider`, and `IndexSnapshot`; Task 1 retrieval functions.
- Produces: `RagHost.start()`, `scan()`, `rebuild()`, `query()`, `cancel()`, `stop()`, status events, and the compiled `ragWorker.js` entry.

- [ ] **Step 1: Define and test the worker protocol**

Use discriminated unions with a required request ID for commands that reply:

```ts
export type RagWorkerIn =
  | { type: 'init'; requestId: string; indexDir: string; modelDir: string; rootPath: string }
  | { type: 'scan'; requestId: string; rootPath: string; rebuild: boolean }
  | { type: 'query'; requestId: string; query: string; scope: RagScope; limit: number }
  | { type: 'cancel'; requestId: string }
  | { type: 'shutdown' };

export type RagWorkerOut =
  | { type: 'ready'; requestId: string; status: RagStatus }
  | { type: 'progress'; status: RagStatus }
  | { type: 'result'; requestId: string; result: RagQueryResult }
  | { type: 'error'; requestId?: string; code: string; message: string };
```

Test exhaustive narrowing and a runtime `isRagWorkerOut()` guard against malformed utility-process messages.

- [ ] **Step 2: Run contract tests and verify failure**

Run: `npx vitest run test/ragContract.spec.ts`

Expected: FAIL because the contract module does not exist.

- [ ] **Step 3: Implement the pinned local embedder**

Use a dynamic import so native runtime packaging follows the existing ASR pattern. Configure cache and local model directories before loading:

```ts
export class LocalE5Embedder implements EmbeddingProvider {
  readonly dimensions = 384;
  static async load(modelDir: string, onProgress?: (percent: number) => void): Promise<LocalE5Embedder>;
  embedPassages(texts: string[], signal?: AbortSignal): Promise<Float32Array>;
  embedQuery(text: string, signal?: AbortSignal): Promise<Float32Array>;
}
```

Call feature extraction with mean pooling, normalization, and quantized ONNX weights. Prefix passage strings with `passage: ` and query strings with `query: `. Validate every returned vector is finite and exactly 384 dimensions.

- [ ] **Step 4: Implement the worker loop**

Adapt the existing ASR utility-port pattern. Keep one model and one committed `IndexSnapshot` resident. Track `AbortController` per request. A query must run lexical retrieval immediately, run query embedding/dense search concurrently, and return lexical-only results when dense search is cancelled or late.

- [ ] **Step 5: Implement `RagHost` request correlation and deadlines**

Export:

```ts
export class RagHost {
  onStatus(cb: (status: RagStatus) => void): () => void;
  start(opts: { indexDir: string; modelDir: string; rootPath: string }): Promise<RagStatus>;
  scan(rootPath: string, rebuild?: boolean): Promise<RagStatus>;
  query(input: RagQueryInput, timeoutMs?: number): Promise<RagQueryResult>;
  cancel(requestId: string): void;
  stop(): Promise<void>;
}
```

`query()` races the worker response against `RAG_QUERY_TIMEOUT_MS`, cancels a timed-out request, and returns `{ chunks: [], sources: [], durationMs, fallback: 'timeout' }` rather than throwing. Worker exit changes status to unavailable and rejects only pending administrative calls; answer queries return an empty fallback.

- [ ] **Step 6: Add the worker build entry and smoke command**

Add `ragWorker: resolve(__dirname, 'electron/rag/worker.ts')` beside `asrWorker` in `electron.vite.config.ts`. Add:

```json
"smoke:rag-model": "node tools/rag-model-smoke.mjs"
```

The smoke script imports the compiled embedder, embeds one Chinese and one English query, verifies two finite 384-dimensional vectors, prints load/embed milliseconds, and exits nonzero on failure. Gate network/model execution with `MC_RAG_MODEL_SMOKE=1`; without it print the exact opt-in command and exit zero.

- [ ] **Step 7: Run contract, build, and opt-out smoke checks**

Run:

```bash
npx vitest run test/ragContract.spec.ts
npm run build
npm run smoke:rag-model
```

Expected: PASS; build emits `out/main/ragWorker.js`; smoke reports that `MC_RAG_MODEL_SMOKE=1` is required and exits zero without downloading.

- [ ] **Step 8: Commit Task 3**

```bash
git add electron/rag/contract.ts electron/rag/embedder.ts electron/rag/worker.ts electron/ragHost.ts test/ragContract.spec.ts tools/rag-model-smoke.mjs electron.vite.config.ts package.json
git commit -m "feat: run local RAG embeddings in a utility process"
```

---

### Task 4: Backward-Compatible Settings, Sessions, IPC, and Preload API

**Files:**
- Modify: `shared/rag.ts`
- Modify: `shared/protocol.ts`
- Modify: `electron/settings.ts`
- Modify: `electron/preload.ts`
- Modify: `test/settings.spec.ts`
- Create: `test/sessions.spec.ts`

**Interfaces:**
- Consumes: Task 1 shared RAG types and Task 3 status/query types.
- Produces: persisted global RAG config, per-session `ragScope`, answer `sources`, and renderer-safe RAG methods.

- [ ] **Step 1: Write failing default and migration tests**

Add assertions that fresh and existing settings remain disabled and preserve unknown fields:

```ts
it('defaults local RAG to disabled without a root', () => {
  expect(defaultSettings('win32').rag).toEqual({ enabled: false });
});

it('loads a pre-RAG v2 file without enabling or rewriting RAG', () => {
  writeFileSync(file, JSON.stringify({ ...defaultSettings(), rag: undefined }), 'utf8');
  const store = new SettingsStore(file, fakeCipher);
  expect(store.data.rag).toEqual({ enabled: false });
  expect(store.getPublic().rag).toEqual({ enabled: false });
});
```

Add a session round-trip test where an old session has no `ragScope` and a new session retains selected root-relative paths and source references.

- [ ] **Step 2: Run compatibility tests and verify failure**

Run: `npx vitest run test/settings.spec.ts test/sessions.spec.ts`

Expected: FAIL because the RAG fields do not exist.

- [ ] **Step 3: Extend schemas without bumping the settings file version**

Add optional-compatible fields:

```ts
// SettingsFile and PublicSettings
rag: { enabled: boolean; rootPath?: string };

// SettingsPatch
rag?: { enabled?: boolean; rootPath?: string };

// StoredSession
ragScope?: RagScope;

// StoredTurn
sources?: RagSourceRef[];
```

Merge `rag` with `{ enabled: false }` in `mergeWithDefaults`. Keep `version: 2`; this is an additive field with safe defaults and does not require rewriting user files.

- [ ] **Step 4: Add IPC channels and preload methods**

Add exact channels:

```ts
ragChooseRoot: 'rag:choose-root',
ragStatusGet: 'rag:status-get',
ragDocumentsGet: 'rag:documents-get',
ragScan: 'rag:scan',
ragRebuild: 'rag:rebuild',
ragStatus: 'rag:status',
```

Expose renderer methods:

```ts
chooseRagRoot(): Promise<string | null>;
getRagStatus(): Promise<RagStatus>;
getRagDocuments(): Promise<RagDocumentStatus[]>;
scanRag(rebuild?: boolean): Promise<RagStatus>;
onRagStatus(cb: (status: RagStatus) => void): () => void;
```

Do not expose raw vectors, index paths, document bodies, or worker commands.

- [ ] **Step 5: Run compatibility and type checks**

Run:

```bash
npx vitest run test/settings.spec.ts test/sessions.spec.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit Task 4**

```bash
git add shared/rag.ts shared/protocol.ts electron/settings.ts electron/preload.ts test/settings.spec.ts test/sessions.spec.ts
git commit -m "feat: add backward-compatible RAG settings and IPC"
```

---

### Task 5: Main-Process RAG Lifecycle and Folder Management

**Files:**
- Modify: `electron/main.ts`
- Modify: `electron/diagnostics.ts`
- Create: `test/ragLifecycle.spec.ts`
- Modify: `test/diagnostics.spec.ts`

**Interfaces:**
- Consumes: Task 3 `RagHost`; Task 4 settings and IPC.
- Produces: explicit folder selection, enable/disable lifecycle, scan/rebuild handlers, status forwarding, safe shutdown, and redacted diagnostics.

- [ ] **Step 1: Extract and test a pure lifecycle decision function**

Create in `electron/ragHost.ts`:

```ts
export type RagLifecycleAction = 'start' | 'restart' | 'stop' | 'none';
export function decideRagLifecycle(
  before: { enabled: boolean; rootPath?: string },
  after: { enabled: boolean; rootPath?: string },
  running: boolean,
): RagLifecycleAction;
```

Tests must cover disabled-to-disabled no-op, enable without root no-op, enable with root start, root change restart, and disable stop.

- [ ] **Step 2: Run lifecycle tests and verify failure**

Run: `npx vitest run test/ragLifecycle.spec.ts`

Expected: FAIL because `decideRagLifecycle` does not exist.

- [ ] **Step 3: Wire the host into application lifecycle**

Instantiate one `RagHost`. Use `join(app.getPath('userData'), 'knowledge-v1')` for index shards and `join(app.getPath('userData'), 'models', 'rag')` for the model cache. Start only after onboarding and only when `settings.data.rag.enabled && settings.data.rag.rootPath`. Stop on disable and `before-quit`.

Folder selection uses:

```ts
dialog.showOpenDialog({
  title: T().ragChooseRootTitle,
  properties: ['openDirectory'],
});
```

Normalize and validate the selected path before saving. Never scan before the renderer explicitly enables RAG.

- [ ] **Step 4: Add scan/status/document IPC handlers**

`rag:status-get` returns replayable current status, `rag:documents-get` returns document metadata and errors only, and scan/rebuild refuse when disabled or missing a root. Forward host progress via `win?.webContents.send(IPC.ragStatus, status)`.

- [ ] **Step 5: Add redacted diagnostics tests and implementation**

Diagnostics may include enabled state, phase, counts, model ID/revision, index schema, last duration, and error codes. Assert that generated output does not contain root paths, relative document paths, document names, excerpts, or chunks.

- [ ] **Step 6: Run lifecycle and diagnostics tests**

Run: `npx vitest run test/ragLifecycle.spec.ts test/diagnostics.spec.ts`

Expected: PASS.

- [ ] **Step 7: Commit Task 5**

```bash
git add electron/main.ts electron/ragHost.ts electron/diagnostics.ts test/ragLifecycle.spec.ts test/diagnostics.spec.ts
git commit -m "feat: manage local RAG lifecycle from the main process"
```

---

### Task 6: Deadline-Bound Retrieval in the Existing Answer Path

**Files:**
- Modify: `shared/protocol.ts`
- Modify: `electron/llm/prompts.ts`
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`
- Modify: `src/App.tsx`
- Modify: `test/llm.spec.ts`
- Create: `test/ragAnswerFallback.spec.ts`

**Interfaces:**
- Consumes: Task 3 `RagHost.query`; Task 4 `RagScope` and `RagSourceRef`.
- Produces: optional retrieved context in prompts, source metadata in `LlmEvent`, and cancellation propagation.

- [ ] **Step 1: Capture the exact legacy prompt before changing code**

Add a regression fixture in `test/llm.spec.ts` that calls `buildAnswerMessages` without retrieved chunks and asserts the complete array, including stable prefix, memo placement, history, transcript, and final question. Do not use a snapshot file; keep the expected strings inline so review shows any change.

- [ ] **Step 2: Write failing retrieved-context prompt tests**

Add:

```ts
it('adds retrieved context only to the dynamic final message', () => {
  const base = buildAnswerMessages(input);
  const withRag = buildAnswerMessages({ ...input, retrievedContext: '【来源：projects/payments.md】\n幂等键避免重复扣款。' });
  expect(withRag[0]).toEqual(base[0]);
  expect(withRag.at(-1)?.content).toContain('本次检索资料');
  expect(withRag.at(-1)?.content).toContain('幂等键');
});

it('is byte-for-byte identical when retrieved context is empty', () => {
  expect(buildAnswerMessages({ ...input, retrievedContext: '' })).toEqual(buildAnswerMessages(input));
});
```

- [ ] **Step 3: Run prompt tests and verify failure**

Run: `npx vitest run test/llm.spec.ts`

Expected: FAIL because `retrievedContext` is not accepted.

- [ ] **Step 4: Implement prompt integration**

Add `retrievedContext?: string` to `AnswerPromptInput`. Append this block to the final user message only when trimmed content exists:

```text
【本次检索资料】
以下资料仅作相关事实参考；简历、岗位 JD 和面试备忘优先。不要在口述答案中提文件名或引用编号。
<packed context>
【检索资料结束】
```

Apply the same optional block to free-form and vision prompt builders. Translation remains unchanged.

- [ ] **Step 5: Write failing answer-fallback orchestration tests**

Extract a pure/injectable helper from `electron/main.ts`:

```ts
export async function retrieveForAnswer(input: {
  host: Pick<RagHost, 'query'>;
  enabled: boolean;
  scope?: RagScope;
  mode: LlmAskPayload['mode'];
  question: string;
  recentTranscript: string[];
}): Promise<RagQueryResult>;
```

Tests require no host call when disabled/translate/no question, an empty result when the host throws, and a query built from the current question plus at most the last three transcript lines.

- [ ] **Step 6: Wire retrieval before streaming without changing legacy payloads**

Extend `LlmAskPayload` and screenshot payload with optional `ragScope`. Extend `LlmEvent` done events with optional `sources`. In `llm:ask`, create the existing request abort controller first, await `retrieveForAnswer`, then build messages and start `chatStream`. `llm:cancel` also calls `ragHost.cancel(requestId)`. The retrieved block and sources remain empty on any failure or deadline.

Return source references only on the `done` event. Do not put document bodies in `LlmEvent`; `excerpt` is capped at 240 characters.

- [ ] **Step 7: Pass session scope from the renderer and persist sources**

`App.askLlm` reads the current session `ragScope` and includes it only when enabled. The LLM event reducer stores `ev.sources` on the finished `StoredTurn`. Old turns and sessions remain valid.

- [ ] **Step 8: Run answer, prompt, and existing LLM tests**

Run:

```bash
npx vitest run test/llm.spec.ts test/ragAnswerFallback.spec.ts
npm run typecheck
```

Expected: PASS; the explicit legacy prompt assertion remains unchanged.

- [ ] **Step 9: Commit Task 6**

```bash
git add shared/protocol.ts electron/llm/prompts.ts electron/main.ts electron/preload.ts src/App.tsx test/llm.spec.ts test/ragAnswerFallback.spec.ts
git commit -m "feat: ground answers with deadline-bound local retrieval"
```

---

### Task 7: Global Knowledge Base Settings UI

**Files:**
- Create: `src/components/KnowledgeBaseSettings.tsx`
- Modify: `src/components/SettingsPanel.tsx`
- Modify: `src/i18n.tsx`
- Modify: `src/styles.css`
- Create: `test/ragUiState.spec.ts`

**Interfaces:**
- Consumes: Task 4 `window.mc` RAG methods and `RagStatus`.
- Produces: explicit enable/folder workflow, progress, counts, errors, rescan/rebuild actions, and remote-LLM disclosure.

- [ ] **Step 1: Extract and test pure settings-view state**

Create and export from the component:

```ts
export function ragActionState(input: {
  enabled: boolean;
  rootPath?: string;
  phase: RagStatus['phase'];
}): { canEnable: boolean; canScan: boolean; canRebuild: boolean; busy: boolean };
```

Tests require that enable is impossible before folder selection, scans are impossible while downloading/scanning/indexing, and disabling remains possible in every phase.

- [ ] **Step 2: Run UI-state tests and verify failure**

Run: `npx vitest run test/ragUiState.spec.ts`

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement `KnowledgeBaseSettings`**

Use existing `settings-section`, `settings-row`, `settings-hint`, `btn`, and warning styles. Props are:

```ts
interface KnowledgeBaseSettingsProps {
  settings: PublicSettings['rag'];
  status: RagStatus;
  onSettingsChange(next: PublicSettings): void;
}
```

The component chooses a folder before enabling, persists `{ rag: { rootPath, enabled } }`, subscribes to progress, and exposes scan/rebuild buttons. A rebuild requires an in-app confirmation before invoking `scanRag(true)`. Show indexed file/chunk/failed counts and per-file error code/message. Do not display document contents.

- [ ] **Step 4: Add complete Chinese and English copy**

Add labels for disabled, choose folder, model download, loading, scanning, embedding, ready, failed files, rescan, rebuild, retry, last update, local-processing statement, and the disclosure: only retrieved snippets are sent to the configured remote LLM.

- [ ] **Step 5: Mount the component in SettingsPanel**

Place it after Common and before Audio so the user sees it without expanding Advanced. Fetch status when the panel opens and keep the rest of `SettingsPanel` state/save behavior unchanged.

- [ ] **Step 6: Run UI state, type, and build checks**

Run:

```bash
npx vitest run test/ragUiState.spec.ts
npm run typecheck
npm run build
```

Expected: PASS.

- [ ] **Step 7: Commit Task 7**

```bash
git add src/components/KnowledgeBaseSettings.tsx src/components/SettingsPanel.tsx src/i18n.tsx src/styles.css test/ragUiState.spec.ts
git commit -m "feat: add local knowledge base settings"
```

---

### Task 8: Per-Session Scope Picker and Answer References

**Files:**
- Create: `src/components/KnowledgeScopeDialog.tsx`
- Modify: `src/components/AnswerSession.tsx`
- Modify: `src/App.tsx`
- Modify: `src/i18n.tsx`
- Modify: `src/styles.css`
- Create: `test/ragScope.spec.ts`

**Interfaces:**
- Consumes: Task 4 document metadata and session `ragScope`; Task 6 stored answer sources.
- Produces: searchable selection, stable normalized scope, and collapsed source display.

- [ ] **Step 1: Write failing scope normalization tests**

Export a pure helper from the new component:

```ts
export function normalizeRagScopeSelection(
  paths: string[],
  knownPaths: string[],
  platform?: NodeJS.Platform,
): string[];
```

Tests require slash normalization, case-insensitive Windows duplicates when a platform argument is `win32`, parent-folder dominance over descendants, stable sort, and removal of paths outside the indexed metadata set.

- [ ] **Step 2: Run scope tests and verify failure**

Run: `npx vitest run test/ragScope.spec.ts`

Expected: FAIL because the helper does not exist.

- [ ] **Step 3: Implement the searchable scope dialog**

Props are:

```ts
interface KnowledgeScopeDialogProps {
  open: boolean;
  documents: RagDocumentStatus[];
  value: RagScope;
  onChange(scope: RagScope): void;
  onClose(): void;
}
```

Offer exactly three modes: disabled, entire library, selected folders/files. Build a root-relative folder tree, filter it by filename/path search, and persist only normalized root-relative selections. Never put the absolute library root in session JSON.

- [ ] **Step 4: Integrate the toolbar control and session persistence**

Add a knowledge-library button next to resume/JD. It indicates disabled, all, or selected count without changing the dimensions of existing toolbar controls. `App` updates only the current session's `ragScope`; new sessions use `{ enabled: false }`.

- [ ] **Step 5: Render collapsed references on completed answers**

When `turn.sources?.length` is nonzero, render one collapsed References button. On expansion show source name, relative path, score rounded to two decimals, and the capped excerpt. References are never rendered inside `.turn-body`, copied answer text, or streaming content.

- [ ] **Step 6: Add Chinese/English scope and reference copy**

Include disabled, full library, selected items, search placeholder, no matches, save/cancel, references, relevance, and unavailable-index text.

- [ ] **Step 7: Run scope and renderer verification**

Run:

```bash
npx vitest run test/ragScope.spec.ts
npm run typecheck
npm run build
```

Expected: PASS.

- [ ] **Step 8: Commit Task 8**

```bash
git add src/components/KnowledgeScopeDialog.tsx src/components/AnswerSession.tsx src/App.tsx src/i18n.tsx src/styles.css test/ragScope.spec.ts
git commit -m "feat: add per-session RAG scope and answer references"
```

---

### Task 9: Performance Gate, Packaged Validation, Documentation, and Full Regression

**Files:**
- Create: `test/ragPerformance.spec.ts`
- Create: `tools/rag-benchmark.mjs`
- Modify: `package.json`
- Modify: `electron-builder.yml`
- Modify: `tools/packaged-smoke.mjs`
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `docs/user/QUICK_START.en.md`
- Modify: `docs/user/QUICK_START.zh-CN.md`
- Modify: `docs/user/TROUBLESHOOTING.en.md`
- Modify: `docs/user/TROUBLESHOOTING.zh-CN.md`

**Interfaces:**
- Consumes: the complete RAG feature.
- Produces: repeatable retrieval benchmarks, packaged-worker/model-cache checks, user documentation, and final evidence that old tests still pass.

- [ ] **Step 1: Add a deterministic retrieval performance test**

Generate 20,000 normalized 384-dimensional vectors and matching multilingual chunks with a fixed seeded PRNG. Warm once, execute 100 searches, and assert exact dense search plus fusion stays below a conservative 250 ms per query in the test environment. Mark the assertion with its corpus size and do not include model download or cold model load in this unit benchmark.

```ts
it('searches a 20k-chunk warm matrix within the retrieval budget', () => {
  const timings = runSyntheticRetrievalBenchmark({ chunks: 20_000, dimensions: 384, queries: 100, seed: 42 });
  expect(percentile(timings, 95)).toBeLessThanOrEqual(250);
});
```

- [ ] **Step 2: Add the end-to-end benchmark command**

Add:

```json
"benchmark:rag": "node tools/rag-benchmark.mjs"
```

The script requires `MC_RAG_BENCHMARK=1`, loads the cached model, indexes a generated Chinese/English corpus, runs 100 warm queries, and prints JSON containing model load, indexing throughput, query embedding P50/P95, dense P50/P95, lexical P50/P95, and total P50/P95. Exit nonzero when total P95 exceeds 300 ms. Without the environment variable, print the exact opt-in command and exit zero.

- [ ] **Step 3: Verify packaged worker and resource layout**

Ensure `out/main/ragWorker.js` is included by the existing `out/**` rule and Transformers/ONNX remain covered by `asarUnpack`. Extend packaged smoke to assert the worker exists, launch with RAG disabled, and verify no `knowledge-v1` scan is started. Do not bundle the model cache into the installer.

- [ ] **Step 4: Document setup, privacy, and recovery in both languages**

Document folder selection, first model download, supported files, global versus per-session scope, references, incremental scans, image-only PDF behavior, rebuild, data location, deleting `knowledge-v1`, and the remote-LLM snippet disclosure. Keep English and Chinese guides structurally equivalent.

- [ ] **Step 5: Run focused RAG tests**

Run:

```bash
npx vitest run test/ragChunker.spec.ts test/ragRetrieval.spec.ts test/ragStore.spec.ts test/ragIndexer.spec.ts test/ragContract.spec.ts test/ragLifecycle.spec.ts test/ragAnswerFallback.spec.ts test/ragUiState.spec.ts test/ragScope.spec.ts test/ragPerformance.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Run the complete project verification**

Run:

```bash
npm run verify
npm run test:python
npm run dist:dir
npm run smoke:packaged
```

Expected: all pre-existing and new tests pass; TypeScript compiles; renderer/main/preload build succeeds; unpacked application starts through both smoke paths.

- [ ] **Step 7: Run the real model and performance smoke on the reference machine**

Run in PowerShell:

```powershell
$env:MC_RAG_MODEL_SMOKE='1'; npm run smoke:rag-model
$env:MC_RAG_BENCHMARK='1'; npm run benchmark:rag
```

Expected: model vectors are finite and 384-dimensional; benchmark JSON reports warm total retrieval P95 `<= 300` ms. If the performance gate fails, optimize allocation/batching within the retrieval implementation before proceeding; do not weaken or remove the threshold.

- [ ] **Step 8: Build the Windows installer and portable application**

Run: `npm run dist:win`

Expected: NSIS and portable artifacts are created under `release/`, start successfully, preserve RAG-disabled behavior, and can download/cache the model only after explicit enablement.

- [ ] **Step 9: Commit Task 9**

```bash
git add test/ragPerformance.spec.ts tools/rag-benchmark.mjs package.json electron-builder.yml tools/packaged-smoke.mjs README.md README.zh-CN.md docs/user/QUICK_START.en.md docs/user/QUICK_START.zh-CN.md docs/user/TROUBLESHOOTING.en.md docs/user/TROUBLESHOOTING.zh-CN.md
git commit -m "docs: validate and document local RAG knowledge base"
```

- [ ] **Step 10: Inspect the final branch diff**

Run:

```bash
git status --short
git log --oneline --decorate origin/main..HEAD
git diff --check origin/main...HEAD
git diff --stat origin/main...HEAD
```

Expected: clean working tree, one design commit plus the nine implementation commits, no whitespace errors, and changes limited to the RAG feature, tests, build configuration, and documentation.
