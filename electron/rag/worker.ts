import { parentPort as threadPort } from 'worker_threads';
import type { RagProgress, RagQueryResult, RagSourceRef, RagStatus } from '../../shared/rag';
import type { RagWorkerIn, RagWorkerOut } from './contract';
import { LocalE5Embedder } from './embedder';
import { RagIndexer, type IndexSnapshot } from './indexer';
import { denseSearch, fuseAndPack, lexicalSearch, sourceName } from './retrieval';
import { RagStore } from './store';

interface UtilPort {
  on(event: 'message', callback: (event: { data: unknown }) => void): void;
  postMessage(message: unknown): void;
}

const utilPort = (process as NodeJS.Process & { parentPort?: UtilPort }).parentPort;
if (!utilPort && !threadPort) throw new Error('RAG worker must run in utilityProcess or worker_threads');

function post(message: RagWorkerOut): void {
  if (utilPort) utilPort.postMessage(message);
  else threadPort!.postMessage(message);
}

function listen(callback: (message: RagWorkerIn) => void): void {
  if (utilPort) utilPort.on('message', (event) => callback(event.data as RagWorkerIn));
  else threadPort!.on('message', (message) => callback(message as RagWorkerIn));
}

let indexer: RagIndexer | null = null;
let embedder: LocalE5Embedder | null = null;
let snapshot: IndexSnapshot = { chunks: [], vectors: new Float32Array(), dimensions: 384, documents: [] };
let status: RagStatus = {
  phase: 'loading',
  enabled: true,
  fileCount: 0,
  chunkCount: 0,
  failedCount: 0,
};
const controllers = new Map<string, AbortController>();

function updateStatus(patch: Partial<RagStatus>): RagStatus {
  status = { ...status, ...patch };
  post({ type: 'progress', status });
  return status;
}

function statusFromSnapshot(phase: RagStatus['phase'], progress?: RagProgress): RagStatus {
  return {
    phase,
    enabled: true,
    fileCount: snapshot.documents.length,
    chunkCount: snapshot.chunks.length,
    failedCount: snapshot.documents.filter((document) => document.state === 'error').length,
    processed: progress?.processed,
    total: progress?.total,
    currentPath: progress?.currentPath,
    lastUpdatedAt: phase === 'ready' ? new Date().toISOString() : status.lastUpdatedAt,
  };
}

async function initialize(message: Extract<RagWorkerIn, { type: 'init' }>): Promise<void> {
  try {
    updateStatus({ phase: 'loading', modelProgress: 0 });
    embedder = await LocalE5Embedder.load(message.modelDir, (modelProgress) =>
      updateStatus({ phase: 'downloading', modelProgress }),
    );
    indexer = new RagIndexer(new RagStore(message.indexDir), embedder);
    snapshot = indexer.load(message.rootPath);
    status = statusFromSnapshot('ready');
    post({ type: 'ready', requestId: message.requestId, status });
  } catch (error) {
    post({ type: 'error', requestId: message.requestId, code: 'MODEL_LOAD_FAILED', message: (error as Error).message });
  }
}

async function scan(message: Extract<RagWorkerIn, { type: 'scan' }>): Promise<void> {
  if (!indexer) {
    post({ type: 'error', requestId: message.requestId, code: 'NOT_READY', message: 'RAG model is not ready' });
    return;
  }
  const controller = new AbortController();
  controllers.set(message.requestId, controller);
  try {
    const onProgress = (progress: RagProgress) => {
      status = statusFromSnapshot(progress.phase, progress);
      post({ type: 'progress', status });
    };
    snapshot = message.rebuild
      ? await indexer.rebuild(message.rootPath, controller.signal, onProgress)
      : await indexer.scan(message.rootPath, controller.signal, onProgress);
    status = statusFromSnapshot('ready');
    post({ type: 'ready', requestId: message.requestId, status });
  } catch (error) {
    if (!controller.signal.aborted) {
      post({ type: 'error', requestId: message.requestId, code: 'SCAN_FAILED', message: (error as Error).message });
    }
  } finally {
    controllers.delete(message.requestId);
  }
}

function sourcesFor(results: ReturnType<typeof fuseAndPack>['results']): RagSourceRef[] {
  return results.map(({ chunk, score }) => ({
    chunkId: chunk.id,
    documentId: chunk.documentId,
    name: sourceName(chunk),
    relativePath: chunk.relativePath,
    score,
    excerpt: chunk.text.slice(0, 240),
  }));
}

async function query(message: Extract<RagWorkerIn, { type: 'query' }>): Promise<void> {
  const started = performance.now();
  const lexical = lexicalSearch(message.query, snapshot.chunks, Math.max(message.limit * 4, 24));
  const controller = new AbortController();
  controllers.set(message.requestId, controller);
  let dense: ReturnType<typeof denseSearch> = [];
  let fallback: RagQueryResult['fallback'];
  try {
    if (!embedder || !snapshot.chunks.length) fallback = 'unavailable';
    else {
      const vector = await embedder.embedQuery(message.query, controller.signal);
      dense = denseSearch(vector, snapshot.vectors, snapshot.chunks, Math.max(message.limit * 4, 24));
    }
  } catch {
    fallback = 'lexical';
  } finally {
    controllers.delete(message.requestId);
  }
  if (controller.signal.aborted) return;
  const packed = fuseAndPack({ lexical, dense, scope: message.scope });
  post({
    type: 'result',
    requestId: message.requestId,
    result: {
      context: packed.context,
      sources: sourcesFor(packed.results).slice(0, message.limit),
      durationMs: performance.now() - started,
      fallback,
    },
  });
}

listen((message) => {
  switch (message.type) {
    case 'init':
      void initialize(message);
      break;
    case 'scan':
      void scan(message);
      break;
    case 'query':
      void query(message);
      break;
    case 'cancel':
      controllers.get(message.requestId)?.abort(new Error('RAG request cancelled'));
      controllers.delete(message.requestId);
      break;
    case 'shutdown':
      for (const controller of controllers.values()) controller.abort(new Error('RAG worker shutting down'));
      controllers.clear();
      setImmediate(() => process.exit(0));
      break;
  }
});
