import { createRequire } from 'module';
import { dirname, join } from 'path';
import { existsSync } from 'fs';
import { pathToFileURL } from 'url';
import { RAG_MODEL_ID, RAG_MODEL_REVISION } from '../../shared/rag';
import type { EmbeddingProvider } from './indexer';

const DIMENSIONS = 384;
const dynamicImport = new Function('u', 'return import(u)') as (url: string) => Promise<any>;

async function importTransformers(): Promise<any> {
  try {
    const require = createRequire(__filename);
    const cjsPath = require.resolve('@huggingface/transformers');
    const mjsPath = join(dirname(cjsPath), 'transformers.node.mjs');
    if (existsSync(mjsPath)) return await dynamicImport(pathToFileURL(mjsPath).href);
  } catch {
    // Fall back to package resolution below.
  }
  return import('@huggingface/transformers');
}

function finiteVectorData(output: any, expectedRows: number): Float32Array {
  const raw = output?.data;
  if (!raw || typeof raw.length !== 'number') throw new Error('Embedding model returned no tensor data');
  if (raw.length !== expectedRows * DIMENSIONS) {
    throw new Error(`Embedding model returned ${raw.length} values; expected ${expectedRows * DIMENSIONS}`);
  }
  const values = Float32Array.from(raw as ArrayLike<number>);
  for (const value of values) {
    if (!Number.isFinite(value)) throw new Error('Embedding model returned a non-finite value');
  }
  return values;
}

export class LocalE5Embedder implements EmbeddingProvider {
  readonly dimensions = DIMENSIONS;

  private constructor(private readonly pipe: any) {}

  static async load(
    modelDir: string,
    onProgress?: (percent: number) => void,
  ): Promise<LocalE5Embedder> {
    const { pipeline, env } = await importTransformers();
    env.cacheDir = modelDir;
    env.allowRemoteModels = true;
    env.allowLocalModels = true;
    const pipe = await pipeline('feature-extraction', RAG_MODEL_ID, {
      revision: RAG_MODEL_REVISION,
      dtype: 'q8',
      progress_callback: (progress: { progress?: number }) => {
        if (typeof progress?.progress === 'number') onProgress?.(Math.max(0, Math.min(100, progress.progress)));
      },
    });
    return new LocalE5Embedder(pipe);
  }

  async embedPassages(texts: string[], signal?: AbortSignal): Promise<Float32Array> {
    return this.embed(texts.map((text) => `passage: ${text}`), signal);
  }

  async embedQuery(text: string, signal?: AbortSignal): Promise<Float32Array> {
    return this.embed([`query: ${text}`], signal);
  }

  private async embed(texts: string[], signal?: AbortSignal): Promise<Float32Array> {
    if (!texts.length) return new Float32Array();
    if (signal?.aborted) throw signal.reason ?? new Error('Embedding cancelled');
    const output = await this.pipe(texts, { pooling: 'mean', normalize: true });
    if (signal?.aborted) throw signal.reason ?? new Error('Embedding cancelled');
    return finiteVectorData(output, texts.length);
  }
}
