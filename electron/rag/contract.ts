import type { RagDocumentStatus, RagQueryResult, RagScope, RagStatus } from '../../shared/rag';

export type RagWorkerIn =
  | { type: 'init'; requestId: string; indexDir: string; modelDir: string; rootPath: string }
  | { type: 'scan'; requestId: string; rootPath: string; rebuild: boolean }
  | { type: 'query'; requestId: string; query: string; scope: RagScope; limit: number }
  | { type: 'cancel'; requestId: string }
  | { type: 'shutdown' };

export type RagWorkerOut =
  | { type: 'ready'; requestId: string; status: RagStatus; documents?: readonly RagDocumentStatus[] }
  | { type: 'progress'; status: RagStatus }
  | { type: 'result'; requestId: string; result: RagQueryResult }
  | { type: 'error'; requestId?: string; code: string; message: string };

function isStatus(value: unknown): value is RagStatus {
  if (!value || typeof value !== 'object') return false;
  const status = value as Partial<RagStatus>;
  return (
    typeof status.phase === 'string' &&
    typeof status.enabled === 'boolean' &&
    typeof status.fileCount === 'number' &&
    typeof status.chunkCount === 'number' &&
    typeof status.failedCount === 'number'
  );
}

function isResult(value: unknown): value is RagQueryResult {
  if (!value || typeof value !== 'object') return false;
  const result = value as Partial<RagQueryResult>;
  return (
    typeof result.context === 'string' &&
    Array.isArray(result.sources) &&
    typeof result.durationMs === 'number'
  );
}

function isDocument(value: unknown): value is RagDocumentStatus {
  if (!value || typeof value !== 'object') return false;
  const document = value as Partial<RagDocumentStatus>;
  return (
    typeof document.id === 'string' &&
    typeof document.relativePath === 'string' &&
    typeof document.name === 'string' &&
    typeof document.size === 'number' &&
    typeof document.mtimeMs === 'number' &&
    typeof document.contentHash === 'string' &&
    typeof document.chunkCount === 'number' &&
    (document.state === 'ready' || document.state === 'error') &&
    typeof document.updatedAt === 'string'
  );
}

export function isRagWorkerOut(value: unknown): value is RagWorkerOut {
  if (!value || typeof value !== 'object') return false;
  const message = value as Partial<RagWorkerOut> & Record<string, unknown>;
  switch (message.type) {
    case 'ready':
      return (
        typeof message.requestId === 'string' &&
        isStatus(message.status) &&
        (message.documents === undefined ||
          (Array.isArray(message.documents) && message.documents.every(isDocument)))
      );
    case 'progress':
      return isStatus(message.status);
    case 'result':
      return typeof message.requestId === 'string' && isResult(message.result);
    case 'error':
      return (
        (message.requestId === undefined || typeof message.requestId === 'string') &&
        typeof message.code === 'string' &&
        typeof message.message === 'string'
      );
    default:
      return false;
  }
}
