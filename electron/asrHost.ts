/**
 * Main-process host for the ASR engine, running in an Electron
 * utilityProcess (separate OS process): spawn, forward audio, relay events,
 * clean shutdown.
 *
 * Why a process and not worker_threads: DML inference inside the Electron
 * main process hangs on real segments once Chromium GPU work is active
 * (root-caused 2026-07-09; the Natively "0 segments" bug). A separate node
 * process matches the environment the engine was validated in.
 */
import { utilityProcess } from 'electron';
import { join } from 'path';
import type { WorkerInMessage, WorkerOutMessage } from './asr/contract';
import type { AsrEvent } from '../shared/protocol';

export interface AsrHostOptions {
  backend: 'local' | 'cloud' | 'cloud-realtime';
  modelsDir: string;
  modelId: string;
  ep: ('dml' | 'cpu')[];
  language: 'auto' | string;
  cloud?: { baseUrl: string; model: string; apiKey: string };
}

export class AsrHost {
  private child: Electron.UtilityProcess | null = null;
  private listeners = new Set<(ev: AsrEvent) => void>();
  /** replayed to late-attaching windows */
  lastReady: AsrEvent | null = null;
  lastStatus: AsrEvent | null = null;

  onEvent(cb: (ev: AsrEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(ev: AsrEvent): void {
    if (ev.kind === 'ready') this.lastReady = ev;
    if (ev.kind === 'status') this.lastStatus = ev;
    for (const cb of this.listeners) cb(ev);
  }

  start(opts: AsrHostOptions): void {
    if (this.child) return;
    this.emit({ kind: 'status', state: 'loading', queuedSegments: 0 });
    const child = utilityProcess.fork(join(__dirname, 'asrWorker.js'), [], {
      serviceName: 'MeetingCopilot ASR',
      // 'inherit' binds to the console, NOT redirected stdout — pipe and
      // forward manually so worker logs land in the main process log.
      stdio: 'pipe',
    });
    this.child = child;
    child.stdout?.on('data', (d: Buffer) => process.stdout.write(d));
    child.stderr?.on('data', (d: Buffer) => process.stderr.write(d));

    child.on('message', (msg: WorkerOutMessage) => {
      switch (msg.type) {
        case 'ready':
          this.emit({ kind: 'ready', loadMs: msg.loadMs, warmMs: msg.warmMs, ep: msg.ep, gpuSuspect: msg.gpuSuspect });
          break;
        case 'segment':
          this.emit({
            kind: 'segment',
            id: msg.id,
            text: msg.text,
            lang: msg.lang,
            speaker: msg.speaker,
            audioMs: msg.audioMs,
            timings: {
              speechStartTs: msg.speechStartTs,
              speechEndTs: msg.speechEndTs,
              vadCloseTs: msg.vadCloseTs,
              inferStartTs: msg.inferStartTs,
              inferEndTs: msg.inferEndTs,
            },
          });
          break;
        case 'partial':
          this.emit({ kind: 'partial', speaker: msg.speaker, text: msg.text });
          break;
        case 'status':
          this.emit({ kind: 'status', state: msg.state, queuedSegments: msg.queuedSegments });
          break;
        case 'error':
          this.emit({ kind: 'error', message: msg.message, fatal: msg.fatal });
          break;
      }
    });
    child.on('exit', (code) => {
      if (code !== 0) {
        this.emit({ kind: 'error', message: `asr process exited with code ${code}`, fatal: true });
      }
      this.child = null;
    });

    this.send({
      type: 'init',
      backend: opts.backend,
      modelsDir: opts.modelsDir,
      modelId: opts.modelId,
      ep: opts.ep,
      language: opts.language,
      cloud: opts.cloud,
    });
  }

  private send(msg: WorkerInMessage): void {
    this.child?.postMessage(msg);
  }

  sendPcm(buf: ArrayBuffer, captureTs: number, channel: 'them' | 'me'): void {
    if (!this.child) return;
    // ~6.4 KB per 100 ms frame — structured-clone copy is negligible
    this.send({ type: 'pcm', pcm: new Float32Array(buf), captureTs, channel });
  }

  setLanguage(language: 'auto' | string): void {
    this.send({ type: 'config', language });
  }

  flush(): void {
    this.send({ type: 'flush' });
  }

  async stop(): Promise<void> {
    const child = this.child;
    if (!child) return;
    this.child = null;
    child.postMessage({ type: 'shutdown' } satisfies WorkerInMessage);
    const timeout = new Promise<void>((res) => setTimeout(res, 1500));
    const exited = new Promise<void>((res) => child.once('exit', () => res()));
    await Promise.race([exited, timeout]);
    child.kill();
  }
}
