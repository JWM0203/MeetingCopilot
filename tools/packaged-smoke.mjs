/**
 * Smoke test for the PACKAGED app (run `npm run dist:dir` first).
 *
 * Packaging breaks things unit tests cannot see: app.asar changes every path,
 * the preload may fail to load, the renderer bundle may be missing, native
 * modules may sit on the wrong side of the archive. This launches the real
 * release/win-unpacked/MeetingCopilot.exe against a throwaway user-data
 * directory and requires proof that the whole chain came up.
 *
 * Success evidence — the MC_E2E_LLM hook (electron/main.ts, did-finish-load)
 * runs a script in the renderer that calls window.mc.llmAsk and waits for the
 * reply, then main logs `[e2e-llm] {...}`. Seeing that single line proves:
 *   main bootstrapped -> BrowserWindow created -> out/renderer/index.html
 *   loaded from inside app.asar -> preload contextBridge exposed window.mc ->
 *   renderer bundle executed -> IPC round-tripped renderer->main->renderer.
 * A fresh profile has no API key, so main answers with its "no API key" error
 * without touching the network — the smoke test never calls a provider.
 *
 * Deliberately NOT treated as failure: the default ASR backend is
 * local-realtime, so boot always tries to spawn the Python sidecar. On a
 * machine without the conda env that logs a sidecar error and a fatal asrEvent.
 * That is a missing optional dependency, not a broken build.
 *
 * Electron stdout is streamed to a file and never piped into another process:
 * a closed pipe raises EPIPE inside the main process, which Electron surfaces
 * as a blocking error dialog and hangs the run.
 */
import { execFileSync, spawn } from 'child_process';
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const exePath = join(repoRoot, 'release', 'win-unpacked', 'MeetingCopilot.exe');
const logPath = join(repoRoot, 'release', 'packaged-smoke.log');

const BOOT_TIMEOUT_MS = 30_000;
const READY_MARKER = '[e2e-llm]';
/** anything here means the packaging itself is broken */
const FATAL_MARKERS = [
  'A JavaScript error occurred in the main process',
  'Uncaught Exception',
  'Cannot find module',
  'MODULE_NOT_FOUND',
  'ERR_FILE_NOT_FOUND',
  'Unable to load preload script',
  'Failed to load URL',
];

function fail(message, extra) {
  console.error(`\nSMOKE_PACKAGED_FAIL: ${message}`);
  if (extra) console.error(extra);
  console.error(`\nfull log: ${logPath}`);
  process.exit(1);
}

if (!existsSync(exePath)) {
  fail(`not built: ${exePath}\nRun \`npm run dist:dir\` first.`);
}

const userData = mkdtempSync(join(tmpdir(), 'mc-packaged-smoke-'));
mkdirSync(dirname(logPath), { recursive: true });
const log = createWriteStream(logPath);
console.log(`[smoke] exe       ${exePath}`);
console.log(`[smoke] userData  ${userData}`);
console.log(`[smoke] log       ${logPath}`);

const child = spawn(exePath, [], {
  cwd: dirname(exePath),
  env: {
    ...process.env,
    MC_USERDATA: userData,
    // asks main to round-trip one IPC call through the renderer on load
    MC_E2E_LLM: 'packaged smoke test',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});

let output = '';
let settled = false;
let timer;

function collect(chunk) {
  const text = chunk.toString();
  output += text;
  log.write(text);
  if (settled) return;
  if (output.includes(READY_MARKER)) finish('ready');
  else if (FATAL_MARKERS.some((m) => output.includes(m))) finish('fatal');
}
child.stdout.on('data', collect);
child.stderr.on('data', collect);

/** taskkill /T so the Python ASR sidecar (a child of electron) dies too */
function killTree() {
  if (!child.pid) return;
  try {
    execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } catch {
    try {
      child.kill();
    } catch {
      /* already gone */
    }
  }
}

function finish(reason) {
  if (settled) return;
  settled = true;
  clearTimeout(timer);
  killTree();
  // let the last stdio chunks land before we read the verdict
  setTimeout(() => verdict(reason), 800);
}

timer = setTimeout(() => finish('timeout'), BOOT_TIMEOUT_MS);
child.on('error', (e) => {
  settled = true;
  clearTimeout(timer);
  fail(`could not launch: ${e.message}`);
});
child.on('exit', () => finish('exit'));

function verdict(reason) {
  log.end();
  const tail = output.split(/\r?\n/).slice(-25).join('\n');
  const hitFatal = FATAL_MARKERS.filter((m) => output.includes(m));
  if (hitFatal.length > 0) {
    fail(`packaging error in the main process: ${hitFatal.join(', ')}`, tail);
  }
  if (!output.includes(READY_MARKER)) {
    fail(
      reason === 'exit'
        ? 'the app exited before the renderer completed an IPC round trip'
        : `no "${READY_MARKER}" within ${BOOT_TIMEOUT_MS / 1000}s`,
      tail,
    );
  }
  // MC_USERDATA must actually have been honoured, otherwise the run just wrote
  // into the developer's real %APPDATA% profile and proves nothing
  const written = existsSync(userData) ? readdirSync(userData) : [];
  if (written.length === 0) {
    fail(`MC_USERDATA was ignored — nothing written to ${userData}`, tail);
  }

  const roundTrip = /\[e2e-llm\].*/.exec(output)?.[0] ?? '';
  console.log(`\n[smoke] ipc round trip : ${roundTrip.trim()}`);
  console.log(`[smoke] userData entries: ${written.length} (${written.slice(0, 4).join(', ')}...)`);
  const sidecarTried = output.includes('[sidecar]');
  console.log(`[smoke] sidecar attempted: ${sidecarTried} (failure here is not a boot failure)`);
  rmSync(userData, { recursive: true, force: true });
  console.log('\nSMOKE_PACKAGED_OK');
  process.exit(0);
}
