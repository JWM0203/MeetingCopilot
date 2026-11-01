import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { RagIndexer, type EmbeddingProvider } from '../electron/rag/indexer';
import { RagStore } from '../electron/rag/store';

let dir: string;
let library: string;
let indexDir: string;

function fakeEmbedder(): EmbeddingProvider {
  return {
    dimensions: 2,
    embedPassages: vi.fn(async (texts: string[]) => {
      const values = new Float32Array(texts.length * 2);
      texts.forEach((text, index) => {
        const first = text.includes('payment') || text.includes('支付') ? 1 : 0;
        values[index * 2] = first;
        values[index * 2 + 1] = first ? 0 : 1;
      });
      return values;
    }),
    embedQuery: vi.fn(async () => new Float32Array([1, 0])),
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mc-rag-indexer-'));
  library = join(dir, 'library');
  indexDir = join(dir, 'index');
  mkdirSync(join(library, 'projects'), { recursive: true });
  writeFileSync(join(library, 'resume.md'), '# Resume\n\nBuilt a payment platform.', 'utf8');
  writeFileSync(join(library, 'projects', 'notes.txt'), '向量检索和性能优化。', 'utf8');
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('RagIndexer', () => {
  it('indexes supported files into one committed snapshot', async () => {
    const embedder = fakeEmbedder();
    const parse = vi.fn(async (path: string) => readFileSync(path, 'utf8'));
    const indexer = new RagIndexer(new RagStore(indexDir), embedder, parse);

    const snapshot = await indexer.scan(library);

    expect(snapshot.documents.map((doc) => doc.relativePath)).toEqual(['projects/notes.txt', 'resume.md']);
    expect(snapshot.documents.every((doc) => doc.state === 'ready')).toBe(true);
    expect(snapshot.chunks.length).toBeGreaterThanOrEqual(2);
    expect(snapshot.vectors.length).toBe(snapshot.chunks.length * 2);
    expect(parse).toHaveBeenCalledTimes(2);
    expect(embedder.embedPassages).toHaveBeenCalled();
  });

  it('does not parse or embed unchanged documents twice', async () => {
    const embedder = fakeEmbedder();
    const parse = vi.fn(async (path: string) => readFileSync(path, 'utf8'));
    const indexer = new RagIndexer(new RagStore(indexDir), embedder, parse);
    await indexer.scan(library);
    const embedCalls = vi.mocked(embedder.embedPassages).mock.calls.length;
    const parseCalls = parse.mock.calls.length;

    await indexer.scan(library);

    expect(parse).toHaveBeenCalledTimes(parseCalls);
    expect(embedder.embedPassages).toHaveBeenCalledTimes(embedCalls);
  });

  it('re-indexes only a changed file and reuses unchanged chunk vectors', async () => {
    const embedder = fakeEmbedder();
    const parse = vi.fn(async (path: string) => readFileSync(path, 'utf8'));
    const indexer = new RagIndexer(new RagStore(indexDir), embedder, parse);
    const first = await indexer.scan(library);
    const oldResume = first.chunks.find((item) => item.relativePath === 'resume.md')!;
    vi.mocked(embedder.embedPassages).mockClear();
    parse.mockClear();

    writeFileSync(
      join(library, 'resume.md'),
      '# Resume\n\nBuilt a payment platform.\n\n# New\n\nLed incident response.',
      'utf8',
    );
    const second = await indexer.scan(library);

    expect(parse).toHaveBeenCalledTimes(1);
    expect(parse.mock.calls[0][0]).toContain('resume.md');
    const embeddedTexts = vi.mocked(embedder.embedPassages).mock.calls.flatMap((call) => call[0]);
    expect(embeddedTexts.some((text) => text.includes('incident response'))).toBe(true);
    expect(embeddedTexts).not.toContain(oldResume.text);
    expect(second.documents).toHaveLength(2);
  });

  it('removes deleted files from the active snapshot and manifest', async () => {
    const store = new RagStore(indexDir);
    const indexer = new RagIndexer(store, fakeEmbedder(), async (path) => readFileSync(path, 'utf8'));
    const first = await indexer.scan(library);
    const removedId = first.documents.find((doc) => doc.relativePath === 'projects/notes.txt')!.id;
    unlinkSync(join(library, 'projects', 'notes.txt'));

    const second = await indexer.scan(library);

    expect(second.documents.map((doc) => doc.relativePath)).toEqual(['resume.md']);
    expect(store.loadDocument(removedId)).toBeNull();
  });

  it('records one parse failure while keeping other documents searchable', async () => {
    const parse = vi.fn(async (path: string) => {
      if (path.endsWith('notes.txt')) throw new Error('permission denied');
      return readFileSync(path, 'utf8');
    });
    const indexer = new RagIndexer(new RagStore(indexDir), fakeEmbedder(), parse);

    const snapshot = await indexer.scan(library);

    expect(snapshot.documents.find((doc) => doc.relativePath === 'projects/notes.txt')).toMatchObject({
      state: 'error',
      errorCode: 'PARSE_FAILED',
    });
    expect(snapshot.chunks.some((item) => item.relativePath === 'resume.md')).toBe(true);
  });

  it('ignores hidden, temporary, unsupported, and external symlink entries', async () => {
    writeFileSync(join(library, '.hidden.md'), 'secret', 'utf8');
    writeFileSync(join(library, '~$draft.docx'), 'temp', 'utf8');
    writeFileSync(join(library, 'photo.png'), 'not a document', 'utf8');
    const outside = join(dir, 'outside');
    mkdirSync(outside);
    writeFileSync(join(outside, 'secret.md'), 'outside secret');
    symlinkSync(outside, join(library, 'external'), process.platform === 'win32' ? 'junction' : 'dir');
    if (process.platform !== 'win32') symlinkSync(join(outside, 'secret.md'), join(library, 'external.md'));
    const indexer = new RagIndexer(
      new RagStore(indexDir),
      fakeEmbedder(),
      async (path) => readFileSync(path, 'utf8'),
    );

    const snapshot = await indexer.scan(library);

    expect(snapshot.documents).toHaveLength(2);
  });
});

it('isolates a file removed after enumeration but before hashing', async () => {
  const parse = async (path: string) => {
    if (path.endsWith('notes.txt')) unlinkSync(join(library, 'resume.md'));
    return readFileSync(path, 'utf8');
  };
  const snapshot = await new RagIndexer(new RagStore(indexDir), fakeEmbedder(), parse).scan(library);
  expect(snapshot.documents.find(d => d.relativePath === 'resume.md')?.state).toBe('error');
  expect(snapshot.chunks.some(c => c.relativePath === 'projects/notes.txt')).toBe(true);
});
it('rejects a shard replaced before its manifest was committed', async () => {
  const store = new RagStore(indexDir);
  const indexer = new RagIndexer(store, fakeEmbedder(), async p => readFileSync(p,'utf8'));
  const snapshot = await indexer.scan(library);
  const doc = snapshot.documents[0];
  const shard = store.loadDocument(doc.id)!;
  store.writeDocument({...doc, contentHash:'new-uncommitted'}, shard.chunks, shard.vectors, shard.dimensions);
  expect(indexer.load(library).documents.find(d => d.id === doc.id)?.errorCode).toBe('CORRUPT_SHARD');
});
