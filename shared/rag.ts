export const RAG_SCHEMA_VERSION = 1 as const;
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
