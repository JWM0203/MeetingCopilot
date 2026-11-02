import { utilityProcess } from 'electron';
import { join } from 'path';
import { randomUUID } from 'crypto';
import {
  RAG_QUERY_TIMEOUT_MS,
  type RagDocumentStatus,
  type RagQueryInput,
  type RagQueryResult,
  type RagStatus,
} from '../shared/rag';
import { isRagWorkerOut, type RagWorkerIn } from './rag/contract';

interface Pending<T> {
  resolve(value: T): void;
  reject(error: Error): void;
}

const EMPTY_STATUS: RagStatus = {
  phase: 'disabled',
  enabled: false,
  fileCount: 0,
  chunkCount: 0,
  failedCount: 0,
};

export type RagLifecycleAction = 'start' | 'restart' | 'stop' | 'none';

export function decideRagLifecycle(
  before: { enabled: boolean; rootPath?: string },
  after: { enabled: boolean; rootPath?: string },
  running: boolean,
): RagLifecycleAction {
  const configured = after.enabled && !!after.rootPath;
  if (!configured) return running ? 'stop' : 'none';
  if (!running) return 'start';
  return before.rootPath !== after.rootPath ? 'restart' : 'none';
}

export class RagHost {
  private generation = 0;
  private options?: { indexDir: string; modelDir: string; rootPath: string };
  private starting?: Promise<RagStatus>;
  private scanning: Promise<unknown> = Promise.resolve();
  private child: Electron.UtilityProcess | null = null;
  private status: RagStatus = EMPTY_STATUS;
  private documents: RagDocumentStatus[] = [];
  private listeners = new Set<(status: RagStatus) => void>();
  private pending = new Map<string, Pending<RagStatus | RagQueryResult>>();

  onStatus(callback: (status: RagStatus) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  get currentStatus(): RagStatus {
    return this.status;
  }

  get currentDocuments(): RagDocumentStatus[] {
    return this.documents.map((document) => ({ ...document }));
  }

  get isRunning(): boolean {
    return this.child !== null;
  }

  private emit(status: RagStatus): void {
    this.status = status;
    for (const listener of this.listeners) listener(status);
  }

  async start(options: { indexDir: string; modelDir: string; rootPath: string }): Promise<RagStatus> {
    this.options = options;
    if (this.starting) return this.starting;
    if (this.child) return this.status;
    this.documents = [];
    this.emit({ ...EMPTY_STATUS, phase: 'loading', enabled: true });
    const child = utilityProcess.fork(join(__dirname, 'ragWorker.js'), [], {
      serviceName: 'MeetingCopilot Knowledge Index',
      stdio: 'pipe',
    });
    this.child = child;
    // Drain pipes without forwarding parser/model output: it can contain local
    // document paths or snippets. User-facing failures travel through typed IPC.
    child.stdout?.on('data', () => undefined);
    child.stderr?.on('data', () => undefined);
    child.on('message', (raw) => { if (this.child === child) this.handleMessage(raw); });
    child.on('exit', (code) => {
      if (this.child !== child) return;
      this.child = null;
      this.emit({ ...this.status, phase: 'unavailable', enabled: true, errorCode: 'WORKER_EXIT', message: `RAG worker exited with code ${code}` });
      for (const pending of this.pending.values()) pending.reject(new Error('RAG worker exited'));
      this.pending.clear();
    });
    const requestId = randomUUID();
    const promise = this.waitFor<RagStatus>(requestId);
    this.send({ type: 'init', requestId, ...options });
    this.starting = promise.catch((error) => {
      if (this.child === child) { this.child = null; child.kill(); }
      throw error;
    }).finally(() => { this.starting = undefined; });
    return this.starting;
  }

  async scan(rootPath: string, rebuild = false): Promise<RagStatus> {
    const generation = this.generation;
    const operation = this.scanning.catch(() => undefined).then(async () => {
      if (generation !== this.generation) throw new Error('RAG scan cancelled');
      if (this.starting) await this.starting;
      if (generation !== this.generation) throw new Error('RAG scan cancelled');
      if (!this.child) {
        if (!this.options) throw new Error('RAG worker is not configured');
        await this.start({ ...this.options, rootPath });
      }
      const requestId = randomUUID();
      const promise = this.waitFor<RagStatus>(requestId);
      this.send({ type: 'scan', requestId, rootPath, rebuild });
      return promise;
    });
    this.scanning = operation;
    return operation;
  }

  async query(input: RagQueryInput, timeoutMs = RAG_QUERY_TIMEOUT_MS): Promise<RagQueryResult> {
    const started = performance.now();
    if (!this.child || !input.scope.enabled || !input.query.trim()) {
      return { context: '', sources: [], durationMs: performance.now() - started, fallback: 'unavailable' };
    }
    const requestId = input.requestId ?? randomUUID();
    const response = this.waitFor<RagQueryResult>(requestId);
    this.send({ type: 'query', requestId, query: input.query, scope: input.scope, limit: input.limit ?? 6 });
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<RagQueryResult>((resolve) => {
      timer = setTimeout(() => {
        this.pending.delete(requestId);
        this.cancel(requestId);
        resolve({ context: '', sources: [], durationMs: performance.now() - started, fallback: 'timeout' });
      }, timeoutMs);
    });
    const result = await Promise.race([response.catch(() => ({
      context: '', sources: [], durationMs: performance.now() - started, fallback: 'error' as const,
    })), timeout]);
    if (timer) clearTimeout(timer);
    return result;
  }

  cancel(requestId: string): void {
    this.send({ type: 'cancel', requestId });
    this.pending.get(requestId)?.reject(new Error('RAG request cancelled'));
    this.pending.delete(requestId);
  }

  async stop(): Promise<void> {
    const child = this.child;
    this.generation++;
    this.options = undefined;
    this.documents = [];
    this.emit(EMPTY_STATUS);
    if (!child) {
      this.emit(EMPTY_STATUS);
      return;
    }
    this.child = null;
    for (const pending of this.pending.values()) pending.reject(new Error('RAG worker stopped'));
    this.pending.clear();
    let timer: NodeJS.Timeout | undefined;
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    try {
      child.postMessage({ type: 'shutdown' } satisfies RagWorkerIn);
      const timeout = new Promise<void>((resolve) => { timer = setTimeout(resolve, 1500); });
      await Promise.race([exited, timeout]);
    } catch {
      // A child exiting concurrently may reject postMessage. Stop is still final
      // and must not poison the main lifecycle queue's shutdown barrier.
    } finally {
      if (timer) clearTimeout(timer);
      try { child.kill(); } catch { /* already gone */ }
    }
  }

  private waitFor<T extends RagStatus | RagQueryResult>(requestId: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.pending.set(requestId, {
        resolve: (value) => resolve(value as T),
        reject,
      });
    });
  }

  private send(message: RagWorkerIn): void {
    this.child?.postMessage(message);
  }

  private handleMessage(raw: unknown): void {
    if (!isRagWorkerOut(raw)) return;
    if (raw.type === 'progress') {
      this.emit(raw.status);
      return;
    }
    if (raw.type === 'error') {
      if (raw.requestId) {
        this.pending.get(raw.requestId)?.reject(new Error(raw.message));
        this.pending.delete(raw.requestId);
      }
      this.emit({ ...this.status, phase: 'error', enabled: true, errorCode: raw.code, message: raw.message });
      return;
    }
    const pending = this.pending.get(raw.requestId);
    if (!pending) return;
    this.pending.delete(raw.requestId);
    if (raw.type === 'ready') {
      if (raw.documents) this.documents = raw.documents.map((document) => ({ ...document }));
      this.emit(raw.status);
      pending.resolve(raw.status);
    } else {
      pending.resolve(raw.result);
    }
  }
}
