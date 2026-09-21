import { describe, expect, it } from 'vitest';
import { isRagWorkerOut, type RagWorkerIn, type RagWorkerOut } from '../electron/rag/contract';

function describeInput(message: RagWorkerIn): string {
  switch (message.type) {
    case 'init':
      return message.indexDir;
    case 'scan':
      return message.rootPath;
    case 'query':
      return message.query;
    case 'cancel':
      return message.requestId;
    case 'shutdown':
      return 'shutdown';
  }
}

function describeOutput(message: RagWorkerOut): string {
  switch (message.type) {
    case 'ready':
      return message.status.phase;
    case 'progress':
      return message.status.phase;
    case 'result':
      return String(message.result.sources.length);
    case 'error':
      return message.code;
  }
}

describe('RAG utility-process protocol', () => {
  it('uses discriminated input unions with request ids on reply commands', () => {
    const messages: RagWorkerIn[] = [
      { type: 'init', requestId: '1', indexDir: 'index', modelDir: 'model', rootPath: 'library' },
      { type: 'scan', requestId: '2', rootPath: 'library', rebuild: false },
      { type: 'query', requestId: '3', query: 'payment latency', scope: { enabled: true }, limit: 6 },
      { type: 'cancel', requestId: '3' },
      { type: 'shutdown' },
    ];
    expect(messages.map(describeInput)).toEqual(['index', 'library', 'payment latency', '3', 'shutdown']);
  });

  it('accepts every valid output variant', () => {
    const outputs: RagWorkerOut[] = [
      {
        type: 'ready',
        requestId: '1',
        status: { phase: 'ready', enabled: true, fileCount: 0, chunkCount: 0, failedCount: 0 },
      },
      {
        type: 'progress',
        status: { phase: 'embedding', enabled: true, fileCount: 1, chunkCount: 2, failedCount: 0 },
      },
      {
        type: 'result',
        requestId: '3',
        result: { context: '', sources: [], durationMs: 4 },
      },
      { type: 'error', requestId: '2', code: 'SCAN_FAILED', message: 'failed' },
    ];
    expect(outputs.every(isRagWorkerOut)).toBe(true);
    expect(outputs.map(describeOutput)).toEqual(['ready', 'embedding', '0', 'SCAN_FAILED']);
  });

  it('rejects malformed or unknown process messages', () => {
    expect(isRagWorkerOut(null)).toBe(false);
    expect(isRagWorkerOut({ type: 'ready', requestId: '1' })).toBe(false);
    expect(isRagWorkerOut({ type: 'result', requestId: 3, result: {} })).toBe(false);
    expect(isRagWorkerOut({ type: 'other' })).toBe(false);
  });
});
