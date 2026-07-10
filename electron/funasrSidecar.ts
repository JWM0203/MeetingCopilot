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
/** both models load + GPU warm ≈ 60-90 s; first-ever run also downloads them */
const READY_TIMEOUT_MS = 180_000;

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

  /** make sure something serves the port; spawn the python sidecar if needed */
  async ensureRunning(port: number, appRoot: string): Promise<void> {
    if (await portOpen(port)) return; // manual instance or an earlier spawn
    if (!this.starting) {
      this.starting = this.spawnAndWait(port, appRoot).finally(() => {
        this.starting = null;
      });
    }
    return this.starting;
  }

  private spawnAndWait(port: number, appRoot: string): Promise<void> {
    const python = process.env.MC_FUNASR_PYTHON ?? DEFAULT_PYTHON;
    const script = join(appRoot, 'tools', 'funasr_stream_server.py');
    if (!existsSync(python)) {
      return Promise.reject(
        new Error(`未找到本地 ASR 运行环境 ${python}（需要 conda env "funasr"，或设 MC_FUNASR_PYTHON）`),
      );
    }
    if (!existsSync(script)) {
      return Promise.reject(new Error(`未找到 ${script}`));
    }
    console.log(`[sidecar] spawning local funasr on :${port} (models load can take ~1 min)`);
    return new Promise((resolve, reject) => {
      const proc = spawn(
        python,
        [script, '--port', String(port), '--model', 'both', '--device', 'auto'],
        { cwd: appRoot, windowsHide: true },
      );
      this.proc = proc;
      let settled = false;
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
      };
      const timer = setTimeout(
        () => settle(() => reject(new Error('本地 FunASR 引擎 180s 内未就绪（首次运行要下载模型，可稍后重试）'))),
        READY_TIMEOUT_MS,
      );
      proc.stdout?.on('data', (d: Buffer) => {
        const s = d.toString();
        process.stdout.write(`[sidecar] ${s}`);
        if (s.includes('FUNASR_READY')) settle(resolve);
      });
      proc.stderr?.on('data', (d: Buffer) => process.stderr.write(d));
      proc.on('exit', (code) => {
        this.proc = null;
        settle(() => reject(new Error(`本地 FunASR 引擎退出（code ${code}）——检查 conda env "funasr"`)));
      });
      proc.on('error', (e) => settle(() => reject(e)));
    });
  }

  /** reap only what we spawned; kill the whole tree (python may have children) */
  stop(): void {
    const p = this.proc;
    this.proc = null;
    if (!p?.pid) return;
    try {
      execFile('taskkill', ['/pid', String(p.pid), '/T', '/F']);
    } catch {
      /* already gone */
    }
  }
}
