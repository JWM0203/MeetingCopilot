import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
  fsyncSync,
} from 'fs';
import { join } from 'path';
import { createHash, randomUUID } from 'crypto';
import {
  RAG_MODEL_ID,
  RAG_MODEL_REVISION,
  RAG_SCHEMA_VERSION,
  type RagChunk,
  type RagDocumentStatus,
} from '../../shared/rag';

export type { RagDocumentStatus } from '../../shared/rag';

export interface RagManifest {
  schemaVersion: typeof RAG_SCHEMA_VERSION;
  modelId: string;
  modelRevision: string;
  dimensions: number;
  rootPath: string;
  updatedAt: string;
  documents: RagDocumentStatus[];
}

interface StoredDocumentJson {
  schemaVersion: typeof RAG_SCHEMA_VERSION;
  dimensions: number;
  meta: RagDocumentStatus;
  chunks: RagChunk[];
  // Metadata and vectors share one atomic replacement: never accept mixed generations.
  vectorData?: string;
  vectorHash?: string;
}

export interface StoredDocumentShard extends StoredDocumentJson {
  vectors: Float32Array;
}

function atomicWrite(path: string, data: string | Uint8Array): void {
  const tmp = `${path}.${randomUUID()}.tmp`;
  const fd = openSync(tmp, 'w');
  try {
    writeFileSync(fd, data);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    renameSync(tmp, path);
  } catch (error) {
    rmSync(tmp, { force: true });
    throw error;
  }
}

function isDocumentStatus(value: unknown): value is RagDocumentStatus {
  if (!value || typeof value !== 'object') return false;
  const doc = value as Partial<RagDocumentStatus>;
  return (
    typeof doc.id === 'string' &&
    typeof doc.relativePath === 'string' &&
    typeof doc.name === 'string' &&
    typeof doc.size === 'number' &&
    typeof doc.mtimeMs === 'number' &&
    typeof doc.contentHash === 'string' &&
    typeof doc.chunkCount === 'number' &&
    (doc.state === 'ready' || doc.state === 'error') &&
    typeof doc.updatedAt === 'string'
  );
}

export class RagStore {
  private readonly shardsDir: string;

  constructor(readonly root: string) {
    this.shardsDir = join(root, 'shards');
  }

  private ensureDirs(): void {
    mkdirSync(this.shardsDir, { recursive: true });
  }

  loadManifest(): RagManifest | null {
    try {
      const raw = JSON.parse(readFileSync(join(this.root, 'manifest.json'), 'utf8')) as Partial<RagManifest>;
      if (
        raw.schemaVersion !== RAG_SCHEMA_VERSION ||
        raw.modelId !== RAG_MODEL_ID ||
        raw.modelRevision !== RAG_MODEL_REVISION ||
        typeof raw.dimensions !== 'number' ||
        typeof raw.rootPath !== 'string' ||
        typeof raw.updatedAt !== 'string' ||
        !Array.isArray(raw.documents) ||
        !raw.documents.every(isDocumentStatus)
      ) {
        return null;
      }
      return raw as RagManifest;
    } catch {
      return null;
    }
  }

  writeManifest(manifest: RagManifest): void {
    this.ensureDirs();
    atomicWrite(join(this.root, 'manifest.json'), JSON.stringify(manifest));
  }

  loadDocument(documentId: string): StoredDocumentShard | null {
    try {
      if (!/^[a-zA-Z0-9_-]+$/.test(documentId)) return null;
      const json = JSON.parse(
        readFileSync(join(this.shardsDir, `${documentId}.json`), 'utf8'),
      ) as Partial<StoredDocumentJson>;
      if (
        json.schemaVersion !== RAG_SCHEMA_VERSION ||
        typeof json.dimensions !== 'number' ||
        !isDocumentStatus(json.meta) ||
        !Array.isArray(json.chunks) ||
        !json.chunks.every((chunk) => chunk && typeof chunk.id === 'string' &&
          chunk.documentId === documentId && typeof chunk.relativePath === 'string' &&
          typeof chunk.text === 'string' && typeof chunk.hash === 'string' &&
          typeof chunk.title === 'string' && Number.isInteger(chunk.ordinal))
      ) {
        return null;
      }
      if (typeof json.vectorData !== 'string' || typeof json.vectorHash !== 'string') return null;
      const bytes = Buffer.from(json.vectorData, 'base64');
      if (createHash('sha256').update(bytes).digest('hex') !== json.vectorHash) return null;
      if (json.meta.id !== documentId || !Number.isInteger(json.dimensions) || json.dimensions! <= 0) return null;
      const expected = json.chunks.length * json.dimensions * Float32Array.BYTES_PER_ELEMENT;
      if (bytes.byteLength !== expected) return null;
      const copied = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      const vectors = new Float32Array(copied);
      if ([...vectors].some((value) => !Number.isFinite(value))) return null;
      return {
        schemaVersion: RAG_SCHEMA_VERSION,
        dimensions: json.dimensions,
        meta: json.meta,
        chunks: json.chunks as RagChunk[],
        vectors,
      };
    } catch {
      return null;
    }
  }

  writeDocument(
    meta: RagDocumentStatus,
    chunks: RagChunk[],
    vectors: Float32Array,
    dimensions: number,
  ): void {
    if (!/^[a-zA-Z0-9_-]+$/.test(meta.id)) throw new Error('Invalid document id');
    if (!Number.isInteger(dimensions) || dimensions <= 0 || [...vectors].some((v) => !Number.isFinite(v))) throw new Error('Invalid vectors');
    if (vectors.length !== chunks.length * dimensions) {
      throw new Error('RAG vector count does not match chunk metadata');
    }
    this.ensureDirs();
    const bytes = Buffer.from(vectors.buffer, vectors.byteOffset, vectors.byteLength);
    const json: StoredDocumentJson = {
      vectorData: bytes.toString('base64'),
      vectorHash: createHash('sha256').update(bytes).digest('hex'),
      schemaVersion: RAG_SCHEMA_VERSION,
      dimensions,
      meta,
      chunks,
    };
    atomicWrite(join(this.shardsDir, `${meta.id}.json`), JSON.stringify(json));

  }

  removeDocument(documentId: string): void {
    if (!/^[a-zA-Z0-9_-]+$/.test(documentId)) return;
    for (const extension of ['json', 'f32']) {
      const path = join(this.shardsDir, `${documentId}.${extension}`);
      try {
        if (existsSync(path)) unlinkSync(path);
      } catch {
        // A stale shard is harmless because only manifest documents are loaded.
      }
    }
  }

  clear(): void {
    rmSync(this.root, { recursive: true, force: true });
  }
}
