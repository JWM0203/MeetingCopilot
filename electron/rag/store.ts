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
  writeSync,
  fsyncSync,
} from 'fs';
import { join } from 'path';
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
}

export interface StoredDocumentShard extends StoredDocumentJson {
  vectors: Float32Array;
}

function atomicWrite(path: string, data: string | Uint8Array): void {
  const tmp = `${path}.tmp`;
  const fd = openSync(tmp, 'w');
  try {
    if (typeof data === 'string') writeSync(fd, data, null, 'utf8');
    else writeSync(fd, data);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, path);
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
      const json = JSON.parse(
        readFileSync(join(this.shardsDir, `${documentId}.json`), 'utf8'),
      ) as Partial<StoredDocumentJson>;
      if (
        json.schemaVersion !== RAG_SCHEMA_VERSION ||
        typeof json.dimensions !== 'number' ||
        !isDocumentStatus(json.meta) ||
        !Array.isArray(json.chunks)
      ) {
        return null;
      }
      const bytes = readFileSync(join(this.shardsDir, `${documentId}.f32`));
      const expected = json.chunks.length * json.dimensions * Float32Array.BYTES_PER_ELEMENT;
      if (bytes.byteLength !== expected) return null;
      const copied = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      return {
        schemaVersion: RAG_SCHEMA_VERSION,
        dimensions: json.dimensions,
        meta: json.meta,
        chunks: json.chunks as RagChunk[],
        vectors: new Float32Array(copied),
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
    if (vectors.length !== chunks.length * dimensions) {
      throw new Error('RAG vector count does not match chunk metadata');
    }
    this.ensureDirs();
    const json: StoredDocumentJson = {
      schemaVersion: RAG_SCHEMA_VERSION,
      dimensions,
      meta,
      chunks,
    };
    atomicWrite(join(this.shardsDir, `${meta.id}.json`), JSON.stringify(json));
    atomicWrite(
      join(this.shardsDir, `${meta.id}.f32`),
      new Uint8Array(vectors.buffer, vectors.byteOffset, vectors.byteLength),
    );
  }

  removeDocument(documentId: string): void {
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
