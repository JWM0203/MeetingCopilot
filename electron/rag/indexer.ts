import { createHash } from 'crypto';
import { lstatSync, readdirSync, readFileSync, statSync } from 'fs';
import { basename, extname, join, relative, resolve } from 'path';
import { DOC_EXTENSIONS, extractDocText } from '../docparse';
import {
  RAG_MODEL_ID,
  RAG_MODEL_REVISION,
  RAG_SCHEMA_VERSION,
  type RagChunk,
  type RagDocumentStatus,
  type RagProgress,
} from '../../shared/rag';
import { chunkDocument } from './chunker';
import { RagStore, type RagManifest, type StoredDocumentShard } from './store';

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

type ParseDocument = typeof extractDocText;

interface SourceFile {
  absolutePath: string;
  relativePath: string;
  size: number;
  mtimeMs: number;
  contentHash: string;
  scanError?: unknown;
  id: string;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new Error('RAG operation aborted');
}

function sha256(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

function normalizeRelative(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '');
}

function scanFiles(rootPath: string, signal?: AbortSignal): SourceFile[] {
  const root = resolve(rootPath);
  const allowed = new Set(DOC_EXTENSIONS.map((extension) => `.${extension}`));
  const output: SourceFile[] = [];

  const visit = (directory: string) => {
    throwIfAborted(signal);
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      throwIfAborted(signal);
      if (entry.name.startsWith('.') || entry.name.startsWith('~$')) continue;
      const absolutePath = join(directory, entry.name);
      try {
        const info = lstatSync(absolutePath);
        if (info.isSymbolicLink()) continue;
        if (info.isDirectory()) {
          visit(absolutePath);
          continue;
        }
        if (!info.isFile() || !allowed.has(extname(entry.name).toLowerCase())) continue;
        const relativePath = normalizeRelative(relative(root, absolutePath));
        if (!relativePath || relativePath.startsWith('../')) continue;
        const stat = statSync(absolutePath);
        output.push({
          absolutePath,
          relativePath,
          size: stat.size,
          mtimeMs: stat.mtimeMs,
          contentHash: '',
          id: sha256(relativePath).slice(0, 32),
        });
      } catch (scanError) {
        throwIfAborted(signal);
        const relativePath = normalizeRelative(relative(root, absolutePath));
        output.push({
          absolutePath, relativePath, size: 0, mtimeMs: 0, contentHash: '',
          id: sha256(relativePath).slice(0, 32), scanError,
        });
      }
    }
  };

  visit(root);
  return output.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

function combineShards(
  documents: readonly RagDocumentStatus[],
  shards: ReadonlyMap<string, StoredDocumentShard>,
  dimensions: number,
): IndexSnapshot {
  const chunks: RagChunk[] = [];
  let vectorCount = 0;
  for (const document of documents) {
    const shard = shards.get(document.id);
    if (!shard || document.state !== 'ready') continue;
    chunks.push(...shard.chunks);
    vectorCount += shard.vectors.length;
  }
  const vectors = new Float32Array(vectorCount);
  let offset = 0;
  for (const document of documents) {
    const shard = shards.get(document.id);
    if (!shard || document.state !== 'ready') continue;
    vectors.set(shard.vectors, offset);
    offset += shard.vectors.length;
  }
  return { chunks, vectors, dimensions, documents };
}

export class RagIndexer {
  constructor(
    private readonly store: RagStore,
    private readonly embedder: EmbeddingProvider,
    private readonly parse: ParseDocument = extractDocText,
  ) {}

  load(rootPath: string): IndexSnapshot {
    const manifest = this.store.loadManifest();
    if (!manifest || resolve(manifest.rootPath) !== resolve(rootPath)) {
      return { chunks: [], vectors: new Float32Array(), dimensions: this.embedder.dimensions, documents: [] };
    }
    const shards = new Map<string, StoredDocumentShard>();
    const documents = manifest.documents.map((document) => {
      if (document.state !== 'ready') return document;
      const shard = this.store.loadDocument(document.id);
      if (!shard || shard.dimensions !== this.embedder.dimensions || shard.meta.contentHash !== document.contentHash) {
        return {
          ...document,
          state: 'error' as const,
          errorCode: 'CORRUPT_SHARD' as const,
          errorMessage: 'Stored vectors are missing or incompatible',
        };
      }
      shards.set(document.id, shard);
      return document;
    });
    return combineShards(documents, shards, this.embedder.dimensions);
  }

  async scan(
    rootPath: string,
    signal?: AbortSignal,
    onProgress?: (progress: RagProgress) => void,
  ): Promise<IndexSnapshot> {
    throwIfAborted(signal);
    onProgress?.({ phase: 'scanning', processed: 0, total: 0 });
    const files = scanFiles(rootPath, signal);
    const previous = this.store.loadManifest();
    const previousByPath = new Map(
      (previous?.rootPath && resolve(previous.rootPath) === resolve(rootPath) ? previous.documents : []).map(
        (document) => [document.relativePath, document],
      ),
    );
    const documents: RagDocumentStatus[] = [];
    const activeShards = new Map<string, StoredDocumentShard>();

    for (let index = 0; index < files.length; index++) {
      throwIfAborted(signal);
      const file = files[index];
      try {
        if (file.scanError) throw file.scanError;
        file.contentHash = sha256(readFileSync(file.absolutePath));
      } catch (error) {
        documents.push(this.errorStatus(file, 'PARSE_FAILED', error));
        continue;
      }
      const oldMeta = previousByPath.get(file.relativePath);
      const oldShard = oldMeta?.state === 'ready' ? this.store.loadDocument(oldMeta.id) : null;
      if (
        oldMeta?.contentHash === file.contentHash &&
        oldShard &&
        oldShard.dimensions === this.embedder.dimensions && oldShard.meta.contentHash === oldMeta.contentHash
      ) {
        const meta = { ...oldMeta, size: file.size, mtimeMs: file.mtimeMs };
        documents.push(meta);
        activeShards.set(meta.id, oldShard);
        onProgress?.({ phase: 'parsing', processed: index + 1, total: files.length, currentPath: file.relativePath });
        continue;
      }

      let text: string;
      try {
        onProgress?.({ phase: 'parsing', processed: index, total: files.length, currentPath: file.relativePath });
        text = await this.parse(file.absolutePath);
      } catch (error) {
        documents.push(this.errorStatus(file, 'PARSE_FAILED', error));
        continue;
      }
      if (!text.trim()) {
        documents.push(this.errorStatus(file, 'EMPTY_DOCUMENT', new Error('Document contains no extractable text')));
        continue;
      }

      const chunks = chunkDocument(file.id, file.relativePath, text);
      try {
        const vectors = await this.embedChunks(chunks, oldShard, signal, (processed) =>
          onProgress?.({
            phase: 'embedding',
            processed,
            total: chunks.length,
            currentPath: file.relativePath,
          }),
        );
        const meta: RagDocumentStatus = {
          id: file.id,
          relativePath: file.relativePath,
          name: basename(file.relativePath),
          size: file.size,
          mtimeMs: file.mtimeMs,
          contentHash: file.contentHash,
          chunkCount: chunks.length,
          state: 'ready',
          updatedAt: new Date().toISOString(),
        };
        this.store.writeDocument(meta, chunks, vectors, this.embedder.dimensions);
        documents.push(meta);
        activeShards.set(meta.id, {
          schemaVersion: RAG_SCHEMA_VERSION,
          dimensions: this.embedder.dimensions,
          meta,
          chunks,
          vectors,
        });
      } catch (error) {
        if (signal?.aborted) throw error;
        documents.push(this.errorStatus(file, 'EMBEDDING_FAILED', error));
      }
    }

    documents.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
    const manifest: RagManifest = {
      schemaVersion: RAG_SCHEMA_VERSION,
      modelId: RAG_MODEL_ID,
      modelRevision: RAG_MODEL_REVISION,
      dimensions: this.embedder.dimensions,
      rootPath: resolve(rootPath),
      updatedAt: new Date().toISOString(),
      documents,
    };
    this.store.writeManifest(manifest);

    const currentIds = new Set(documents.map((document) => document.id));
    for (const old of previous?.documents ?? []) {
      if (!currentIds.has(old.id)) this.store.removeDocument(old.id);
    }
    onProgress?.({ phase: 'ready', processed: files.length, total: files.length });
    return combineShards(documents, activeShards, this.embedder.dimensions);
  }

  async rebuild(
    rootPath: string,
    signal?: AbortSignal,
    onProgress?: (progress: RagProgress) => void,
  ): Promise<IndexSnapshot> {
    this.store.clear();
    return this.scan(rootPath, signal, onProgress);
  }

  private errorStatus(
    file: SourceFile,
    errorCode: NonNullable<RagDocumentStatus['errorCode']>,
    error: unknown,
  ): RagDocumentStatus {
    return {
      id: file.id,
      relativePath: file.relativePath,
      name: basename(file.relativePath),
      size: file.size,
      mtimeMs: file.mtimeMs,
      contentHash: file.contentHash,
      chunkCount: 0,
      state: 'error',
      errorCode,
      errorMessage: error instanceof Error ? error.message : String(error),
      updatedAt: new Date().toISOString(),
    };
  }

  private async embedChunks(
    chunks: RagChunk[],
    previous: StoredDocumentShard | null,
    signal?: AbortSignal,
    onProgress?: (processed: number) => void,
  ): Promise<Float32Array> {
    const dimensions = this.embedder.dimensions;
    const output = new Float32Array(chunks.length * dimensions);
    const reusable = new Map<string, Float32Array>();
    if (previous?.dimensions === dimensions) {
      previous.chunks.forEach((chunk, index) => {
        reusable.set(
          chunk.hash,
          previous.vectors.slice(index * dimensions, (index + 1) * dimensions),
        );
      });
    }
    const missing: { index: number; text: string }[] = [];
    chunks.forEach((chunk, index) => {
      const vector = reusable.get(chunk.hash);
      if (vector) output.set(vector, index * dimensions);
      else missing.push({ index, text: chunk.text });
    });

    let processed = chunks.length - missing.length;
    onProgress?.(processed);
    for (let offset = 0; offset < missing.length; offset += 16) {
      throwIfAborted(signal);
      const batch = missing.slice(offset, offset + 16);
      const vectors = await this.embedder.embedPassages(
        batch.map((item) => item.text),
        signal,
      );
      if (vectors.length !== batch.length * dimensions) {
        throw new Error('Embedding provider returned an unexpected vector count');
      }
      batch.forEach((item, index) => {
        output.set(vectors.subarray(index * dimensions, (index + 1) * dimensions), item.index * dimensions);
      });
      processed += batch.length;
      onProgress?.(processed);
    }
    return output;
  }
}
