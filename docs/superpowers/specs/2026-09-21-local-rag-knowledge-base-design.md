# Local RAG Knowledge Base Design

## Summary

MeetingCopilot currently supports a per-session resume and job-description slot. Those documents are clipped to a fixed character budget and inserted directly into the LLM prompt. This design adds an optional, fully local retrieval pipeline for a much larger, continuously growing document library while preserving the current behavior when RAG is disabled or unavailable.

The feature indexes a user-selected folder containing PDF, DOCX, TXT, and Markdown files. Parsing, chunking, embedding, indexing, and retrieval run locally. At answer time, only a small set of relevant chunks is sent to the user's configured LLM along with the existing prompt. If that LLM is remote, the selected chunks leave the machine; the full library does not.

## Goals

- Support hundreds of documents and continued library growth.
- Keep document parsing, embeddings, and retrieval local.
- Provide semantic and exact-term retrieval for Chinese, English, and mixed-language material.
- Keep warm-query retrieval P95 at or below 300 ms on the reference development machine.
- Preserve the existing ASR, resume/JD, prompt-prefix caching, answer streaming, and session behavior when RAG is disabled.
- Fail open to the current answer path if indexing or retrieval is unavailable.
- Re-index only added or changed documents.
- Let every interview session use the whole global library or a selected subset.

## Non-Goals

- Cloud synchronization or multi-device knowledge libraries.
- OCR for scanned PDFs in the first version.
- Editing source documents inside MeetingCopilot.
- A hosted embedding service.
- Replacing the existing resume and JD slots.
- A native vector database or approximate-nearest-neighbor dependency in the first version.
- Guaranteeing a fixed latency on every possible machine. The 300 ms value is a benchmark target backed by a timeout and fallback policy.

## Existing Behavior to Preserve

- `electron/knowledge.ts` continues to support the legacy single-file knowledge store.
- Per-session resume and JD files remain the highest-priority personal context.
- `buildStablePrefix` remains byte-stable for identical resume, JD, and language inputs.
- DeepSeek prefix-cache prewarming remains unchanged.
- Answer generation streams through the existing LLM adapter.
- Sessions without RAG settings behave identically to sessions created before this feature.
- ASR workers and real-time audio paths never wait for indexing or retrieval.

## Architecture

### Process Boundaries

The Electron main process owns lifecycle and IPC but does not perform document indexing or query embedding. A dedicated `KnowledgeIndexService` runs in an Electron `utilityProcess` and exposes a small request/response protocol:

- initialize and load the persisted index;
- select or replace the library root;
- scan and incrementally update the index;
- query with a session scope and deadline;
- report progress, health, and document errors;
- cancel obsolete scans and queries;
- rebuild the versioned index.

The renderer receives only status, document metadata, session selections, and retrieval source references. Raw vectors never enter the renderer.

### Indexing Flow

1. The user explicitly enables RAG and chooses one library root.
2. The service downloads and caches the quantized multilingual embedding model if it is not present.
3. A bounded-concurrency scanner walks the root and accepts `.pdf`, `.docx`, `.txt`, and `.md` files.
4. Each file is identified by its normalized path, size, modification time, and content hash.
5. Existing document parsing is reused. Parse failures are recorded per file and do not stop the scan.
6. Text is split on headings, lists, and paragraph boundaries into approximately 500-800 character chunks with limited overlap.
7. Chunk hashes are compared with the existing document shard. Identical chunks reuse their existing vectors.
8. New chunks are embedded in batches in the utility process.
9. Metadata and vectors are written to temporary shard files, flushed, and atomically renamed.
10. Deleted files are removed from the active manifest and their shards are deleted after the manifest update succeeds.

### Retrieval Flow

1. The current question and a small bounded set of recent transcript lines form one retrieval query.
2. Query embedding and lexical retrieval run in parallel.
3. Dense cosine similarity returns semantic candidates. A lightweight lexical scorer over normalized tokens and CJK n-grams returns exact-term candidates.
4. Reciprocal-rank fusion combines the candidate lists.
5. Results outside the current session's enabled paths are removed.
6. Near-duplicate chunks and excessive results from one document are suppressed.
7. The top 4-6 chunks are packed into a fixed context budget.
8. Retrieved context is added to the dynamic final user message, after the stable prompt prefix and memo/history layers.
9. The answer is generated through the unchanged streaming LLM path.

Resume and JD context remains authoritative. Retrieved chunks are explicitly labeled as supporting material and may not override facts in the resume or the rolling interview memo.

## Embedding and Ranking

The default model is a quantized ONNX build of `multilingual-e5-small`, loaded through the project's existing `@huggingface/transformers` runtime. It supports Chinese and English and produces compact normalized vectors. The exact model revision is pinned so an upstream change cannot silently invalidate an index.

Document chunks use the model's passage prefix and live queries use its query prefix. Vectors are normalized once during indexing, allowing cosine similarity to be computed as a dot product. A contiguous `Float32Array` is built when shards are loaded so search does not allocate one object per vector.

The first release uses exact dense search because it avoids native packaging risk and should remain within the target for the expected corpus. The index format and retrieval interface do not assume exact search, so a future approximate index can replace it without changing UI or prompt code.

Retrieval has a 250 ms soft deadline. If dense retrieval is cold or late, the request uses lexical results. If no usable result is ready, answer generation continues without RAG. Enabling RAG starts model warming and index loading in the background so normal queries use the warm path.

## Persistence

RAG state lives in a new versioned directory under Electron `userData`:

```text
knowledge-v1/
  manifest.json
  model/
  shards/
    <document-id>.json
    <document-id>.f32
```

The manifest contains schema version, model identifier and revision, root path, scan state, document hashes, chunk counts, and error summaries. JSON shard files contain source metadata and chunk text. Binary shard files contain vectors in row-major float32 format.

The selected library root and the global enabled flag are added as optional settings with disabled defaults. Each stored session gains an optional RAG scope containing an enabled flag and normalized included paths. Missing fields deserialize to disabled, preserving old session files without a migration rewrite.

Path comparisons are case-insensitive on Windows and case-sensitive on macOS. Symlinks that resolve outside the selected root are not followed. Hidden files, temporary office files, generated index directories, and unsupported extensions are ignored.

## User Interface

### Settings

A new Local Knowledge Base section provides:

- an enable switch;
- a folder picker;
- model download and load state;
- scan, parse, embedding, and ready progress;
- counts for indexed files, chunks, and failed files;
- last successful update time;
- rescan and rebuild actions;
- a list of per-file errors without document contents.

Selecting a folder does not block settings or the main interview interface. Disabling RAG unloads the model and active vector matrix after in-flight work is cancelled, while persisted shards remain for fast re-enabling.

### Session Scope

The answer session toolbar receives a knowledge-library control next to the existing resume and JD controls. It opens a searchable tree of subfolders and files with these modes:

- RAG disabled for this session;
- use the entire indexed library;
- use selected folders and files.

The selection is stored with the session. Deleting a session never deletes global index data. Existing sessions start with RAG disabled. New sessions also start disabled unless the user explicitly changes the session scope.

### Answer Sources

An answer turn may carry optional source references containing document name, relative path, chunk identifier, and score. The spoken answer never contains citation markers. A collapsed References control below the completed answer exposes the source list for verification. No document text is shown until the user expands it.

## Prompt Integration

The existing prompt builders gain an optional retrieved-context input. When the input is absent or empty, output must be byte-for-byte identical to the current implementation.

Retrieved context is placed in the final dynamic user message rather than `buildStablePrefix`. This preserves prefix-cache hits across questions. The block instructs the model to:

- prefer resume and JD facts over general library content;
- use retrieved material only when relevant;
- avoid inventing details not supported by the available context;
- produce the same concise first-person teleprompter answer format;
- omit source names and citation language from the spoken response.

Free-form and screenshot questions may use RAG through the same retrieval interface, but translation requests never invoke retrieval.

## Performance Controls

- Keep the embedding model warm only while RAG is globally enabled.
- Load shard metadata and vectors asynchronously after application startup.
- Batch document embeddings and cap parser/embedding concurrency.
- Reuse vectors by chunk content hash.
- Store normalized vectors contiguously and reuse query/search buffers.
- Run lexical and dense retrieval in parallel.
- Cancel superseded live queries.
- Enforce the 250 ms retrieval soft deadline.
- Limit the number of retrieved chunks and total prompt characters.
- Record retrieval duration, candidate counts, fallback reason, and index size without logging source text.

Indexing yields or reduces concurrency while live capture is active. Answer generation never waits for a background scan to finish and searches the last committed index snapshot.

## Failure Handling

- Model download failure leaves RAG unavailable and exposes a retry action.
- Unsupported, unreadable, encrypted, or image-only documents are reported per file.
- Corrupt shards are excluded and scheduled for rebuild.
- A utility-process crash changes health state to unavailable and uses the old answer path; the service may restart outside an active query.
- Retrieval timeout uses lexical candidates or no RAG context.
- Atomic shard and manifest replacement prevents partially written active indexes.
- An index schema or model revision mismatch creates a fresh versioned build rather than mutating incompatible data.
- Closing the application cancels downloads, scans, embeddings, and queries cleanly.

## Privacy and Security

- Directory scanning, parsing, chunking, embedding, vector storage, and retrieval are local.
- API keys remain in the existing main-process credential path.
- Raw vectors and document bodies are not exposed to renderer IPC.
- Logs and diagnostics contain paths only when explicitly requested and never include document contents or embeddings.
- The user interface explains that selected chunks are sent to a configured remote LLM during answer generation.
- The scanner prevents traversal outside the chosen root and does not follow external symlink targets.

## Testing Strategy

### Unit Tests

- deterministic heading/paragraph chunking and overlap;
- stable file and chunk hashing;
- lexical scoring for English tokens, CJK n-grams, numbers, and technical identifiers;
- dense score calculation and reciprocal-rank fusion;
- session path filtering, deduplication, and per-document caps;
- context packing within the character budget;
- prompt construction with and without retrieved context;
- manifest validation and schema mismatch behavior;
- timeout, cancellation, and fallback decisions.

### Integration Tests

- index representative PDF, DOCX, TXT, and Markdown fixtures;
- retrieve Chinese, English, and mixed-language facts;
- add, modify, rename, and delete files incrementally;
- reuse vectors for unchanged chunk hashes;
- survive a corrupt manifest or shard;
- preserve usable shards when one file fails;
- isolate two sessions with different enabled paths;
- restart and reload a persisted index;
- crash or time out the worker and continue through the legacy answer path.

### Regression and Packaging Tests

- assert byte-for-byte prompt equality when retrieved context is absent;
- run the existing TypeScript and Python test suites;
- run type checking and the production build;
- run packaged application smoke tests;
- verify model cache, utility-process resources, and index paths in a packaged Windows build;
- verify that RAG-disabled startup does not load the model or scan files.

### Performance Tests

A generated multilingual corpus exercises warm retrieval at several index sizes. The benchmark reports P50 and P95 query embedding, lexical search, dense search, fusion, and total retrieval time. The acceptance target is warm total retrieval P95 at or below 300 ms on the reference development machine. Tests also verify that the 250 ms soft deadline returns a valid fallback rather than delaying an answer.

## Acceptance Criteria

- A user can select a folder and incrementally index supported documents without blocking the main UI or ASR.
- A session can disable RAG, use the complete library, or select folders/files.
- Relevant Chinese and English material appears in answer context and reference metadata.
- No RAG context or service failure produces the existing prompt and answer path.
- Resume and JD facts retain priority over retrieved general material.
- Existing tests plus new RAG tests pass, and the application builds and packages successfully.
- Warm retrieval meets the performance target on the reference machine or falls back by the configured deadline.
- The application clearly discloses when retrieved snippets will be sent to a remote LLM.

## Delivery Sequence

1. Add pure chunking, ranking, scope, persistence-schema, and prompt-context modules with tests.
2. Add the utility-process protocol and local model lifecycle.
3. Add incremental per-document indexing and persistence.
4. Integrate deadline-bound retrieval into answer generation behind disabled defaults.
5. Add settings, session scope, progress, errors, and answer references.
6. Add integration, regression, performance, and packaged-build coverage.
