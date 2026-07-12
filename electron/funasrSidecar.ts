/**
 * Auto-managed local FunASR sidecar. When the streaming ASR backend points at
 * ws://127.0.0.1:<port>, the app spawns tools/funasr_stream_server.py itself
 * (python from the `funasr` conda env) and reaps it on quit — selecting the
 * local preset in settings is all the user does; no manual .bat.
 *
 * If something already listens on the port (sidecar started manually or left
 * over), it is reused and never killed by us — we only reap processes we
 * spawned.
 */
import { spawn, execFile, type ChildProcess } from 'child_process';
import { connect } from 'net';
import { existsSync } from 'fs';
import { join } from 'path';

const DEFAULT_PYTHON = 'C:\\ProgramData\\miniconda3\\envs\\funasr\\python.exe';
/** model load + warm; first-ever run also downloads the selected model */
const READY_TIMEOUT_MS = 15 * 60_000;

export function pythonCandidates(
  appRoot: string,
  platform: string = process.platform,
  explicit: string | undefined = process.env.MC_FUNASR_PYTHON,
): string[] {
  const venv =
    platform === 'win32'
      ? join(appRoot, '.venv', 'Scripts', 'python.exe')
      : join(appRoot, '.venv', 'bin', 'python');
  const candidates = [
    explicit,
    venv,
    ...(platform === 'win32' ? [DEFAULT_PYTHON, 'python'] : ['python3', 'python']),
  ].filter((v): v is string => !!v);
  return [...new Set(candidates)];
}

async function canRunPython(candidate: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(candidate, ['--version'], { timeout: 5_000 }, (error) => resolve(!error));
  });
}

export async function resolvePython(
  candidates: string[],
  probe: (candidate: string) => Promise<boolean> = canRunPython,
): Promise<string> {
  for (const candidate of candidates) {
    if (await probe(candidate)) return candidate;
  }
  throw new Error(
    `未找到可用 Python（已尝试 ${candidates.join(', ')}）；请创建 .venv 或设置 MC_FUNASR_PYTHON`,
  );
}

export function sidecarModelArg(model: string | undefined): 'nano' | 'paraformer' {
  return model?.toLowerCase().includes('paraformer') ? 'paraformer' : 'nano';
}

export type SidecarStopPlan =
  | { kind: 'command'; file: string; args: string[] }
  | { kind: 'signal'; pid: number; signal: NodeJS.Signals };

export function sidecarStopPlan(platform: string, pid: number): SidecarStopPlan {
  if (platform === 'win32') {
    return { kind: 'command', file: 'taskkill', args: ['/pid', String(pid), '/T', '/F'] };
  }
  return { kind: 'signal', pid: -pid, signal: 'SIGTERM' };
}

/** ws://127.0.0.1:10097/... -> 10097; null for anything non-local (pure, tested) */
export function parseLocalWsPort(url: string | undefined): number | null {
  if (!url) return null;
  const m = /^ws:\/\/(?:127\.0\.0\.1|localhost)(?::(\d+))?(?:\/|$)/i.exec(url.trim());
  if (!m) return null;
  return m[1] ? parseInt(m[1], 10) : 80;
}

function portOpen(port: number, timeoutMs = 600): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = connect({ port, host: '127.0.0.1' });
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      sock.destroy();
      resolve(ok);
    };
    sock.once('connect', () => done(true));
    sock.once('error', () => done(false));
    sock.setTimeout(timeoutMs, () => done(false));
  });
}

export class FunasrSidecar {
  private proc: ChildProcess | null = null;
  private starting: Promise<void> | null = null;
  private modelArg: 'nano' | 'paraformer' | null = null;

  /** make sure something serves the port; spawn the python sidecar if needed */
  async ensureRunning(port: number, appRoot: string, model?: string): Promise<void> {
    const requestedModel = sidecarModelArg(model);
    if (this.proc && this.modelArg !== requestedModel) await this.stop();
    if (await portOpen(port)) return; // manual instance or an earlier spawn
    if (!this.starting) {
      this.starting = this.spawnAndWait(port, appRoot, requestedModel).finally(() => {
        this.starting = null;
      });
    }
    return this.starting;
  }

  private async spawnAndWait(
    port: number,
    appRoot: string,
    modelArg: 'nano' | 'paraformer',
  ): Promise<void> {
    const python = await resolvePython(pythonCandidates(appRoot));
    const script = join(appRoot, 'tools', 'funasr_stream_server.py');
    if (!existsSync(script)) {
      throw new Error(`未找到 ${script}`);
    }
    console.log(
      `[sidecar] spawning local funasr model=${modelArg} on :${port} (models load can take ~1 min)`,
    );
    return new Promise((resolve, reject) => {
      const proc = spawn(
        python,
        [script, '--port', String(port), '--model', modelArg, '--device', 'auto'],
        { cwd: appRoot, windowsHide: true, detached: process.platform !== 'win32' },
      );
      this.proc = proc;
      this.modelArg = modelArg;
      let settled = false;
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
      };
      const timer = setTimeout(() => {
        settle(() => {
          void this.stop().finally(() =>
            reject(new Error('本地 FunASR 引擎 15 分钟内未就绪（请检查模型下载和 Python 日志）')),
          );
        });
      }, READY_TIMEOUT_MS);
      proc.stdout?.on('data', (d: Buffer) => {
        const s = d.toString();
        process.stdout.write(`[sidecar] ${s}`);
        if (s.includes('FUNASR_READY')) settle(resolve);
      });
      proc.stderr?.on('data', (d: Buffer) => process.stderr.write(d));
      proc.on('exit', (code) => {
        this.proc = null;
        this.modelArg = null;
        settle(() => reject(new Error(`本地 FunASR 引擎退出（code ${code}）——检查 conda env "funasr"`)));
      });
      proc.on('error', (e) => settle(() => reject(e)));
    });
  }

  /** reap only what we spawned; kill the whole tree (python may have children) */
  async stop(): Promise<void> {
    const p = this.proc;
    this.proc = null;
    this.modelArg = null;
    if (!p?.pid) return;
    let didExit = false;
    const exited = new Promise<void>((resolve) =>
      p.once('exit', () => {
        didExit = true;
        resolve();
      }),
    );
    const plan = sidecarStopPlan(process.platform, p.pid);
    try {
      if (plan.kind === 'command') {
        execFile(plan.file, plan.args, () => undefined);
      } else {
        process.kill(plan.pid, plan.signal);
      }
    } catch {
      p.kill('SIGTERM');
    }
    await Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, 2_000))]);
    if (!didExit) {
      try {
        if (process.platform === 'win32') p.kill();
        else process.kill(-p.pid, 'SIGKILL');
      } catch {
        p.kill('SIGKILL');
      }
    }
  }
}
