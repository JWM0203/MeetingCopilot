import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { RAG_MODEL_ID, RAG_MODEL_REVISION, RAG_SCHEMA_VERSION, type RagChunk } from '../shared/rag';
import { RagStore, type RagDocumentStatus, type RagManifest } from '../electron/rag/store';

let dir: string;

function document(id = 'doc-one'): RagDocumentStatus {
  return {
    id,
    relativePath: 'notes/one.md',
    name: 'one.md',
    size: 12,
    mtimeMs: 100,
    contentHash: 'content-hash',
    chunkCount: 2,
    state: 'ready',
    updatedAt: '2026-09-21T00:00:00.000Z',
  };
}

function chunks(): RagChunk[] {
  return [
    { id: 'c1', documentId: 'doc-one', relativePath: 'notes/one.md', title: 'one.md', text: 'alpha', ordinal: 0, hash: 'h1' },
    { id: 'c2', documentId: 'doc-one', relativePath: 'notes/one.md', title: 'one.md', text: 'beta', ordinal: 1, hash: 'h2' },
  ];
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mc-rag-store-'));
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('RagStore', () => {
  it('round-trips metadata and row-major float32 vectors', () => {
    const store = new RagStore(dir);
    store.writeDocument(document(), chunks(), new Float32Array([1, 0, 0, 1]), 2);

    const loaded = store.loadDocument('doc-one');
    expect(loaded?.meta).toEqual(document());
    expect(loaded?.chunks).toEqual(chunks());
    expect([...loaded!.vectors]).toEqual([1, 0, 0, 1]);
    expect(loaded?.dimensions).toBe(2);
    expect(existsSync(join(dir, 'shards', 'doc-one.json.tmp'))).toBe(false);
  });

  it('round-trips a compatible manifest and rejects another schema or model', () => {
    const store = new RagStore(dir);
    const manifest: RagManifest = {
      schemaVersion: RAG_SCHEMA_VERSION,
      modelId: RAG_MODEL_ID,
      modelRevision: RAG_MODEL_REVISION,
      dimensions: 2,
      rootPath: 'C:/knowledge',
      updatedAt: '2026-09-21T00:00:00.000Z',
      documents: [document()],
    };
    store.writeManifest(manifest);
    expect(store.loadManifest()).toEqual(manifest);

    const raw = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
    raw.schemaVersion = 999;
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(raw));
    expect(store.loadManifest()).toBeNull();
  });

  it('excludes a shard whose vector byte count does not match metadata', () => {
    const store = new RagStore(dir);
    store.writeDocument(document(), chunks(), new Float32Array([1, 0, 0, 1]), 2);
    const path = join(dir, 'shards', 'doc-one.json');
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    raw.vectorData = Buffer.alloc(3).toString('base64');
    writeFileSync(path, JSON.stringify(raw));
    expect(store.loadDocument('doc-one')).toBeNull();
  });

  it('removes one document without touching other shards', () => {
    const store = new RagStore(dir);
    store.writeDocument(document('first'), [{ ...chunks()[0], documentId: 'first' }], new Float32Array([1, 0]), 2);
    store.writeDocument(document('second'), [{ ...chunks()[0], documentId: 'second' }], new Float32Array([0, 1]), 2);
    store.removeDocument('first');
    expect(store.loadDocument('first')).toBeNull();
    expect(store.loadDocument('second')).not.toBeNull();
  });
});

it('ignores an interrupted temporary replacement and rejects same-sized vector corruption', () => {
  const store = new RagStore(dir);
  store.writeDocument(document(), chunks(), new Float32Array([1,0,0,1]), 2);
  const path = join(dir, 'shards', 'doc-one.json');
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  writeFileSync(path + '.interrupted.tmp', '{');
  expect([...store.loadDocument('doc-one')!.vectors]).toEqual([1,0,0,1]);
  raw.vectorData = Buffer.alloc(16).toString('base64');
  writeFileSync(path, JSON.stringify(raw));
  expect(store.loadDocument('doc-one')).toBeNull();
});
