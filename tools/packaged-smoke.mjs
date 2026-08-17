/**
 * Smoke test for the PACKAGED app (run `npm run dist:dir` first).
 *
 * Packaging breaks things unit tests cannot see: app.asar changes every path,
 * a preload may fail to load, a renderer bundle may be missing, native modules
 * may sit on the wrong side of the archive. This launches the real
 * release/win-unpacked/MeetingCopilot.exe against throwaway user-data
 * directories and requires proof that the whole chain came up.
 *
 * Two scenarios, because the app now has two possible startup paths:
 *
 * 1. "main window" — MC_DEV_DEFAULT_LOCAL_ASR=1 marks onboarding complete, so
 *    boot must go straight to the overlay. Evidence: the MC_E2E_LLM hook
 *    (electron/main.ts, did-finish-load) runs a script in the renderer that
 *    calls window.mc.llmAsk and waits for the reply, then main logs
 *    `[e2e-llm] {...}`. That single line proves: main bootstrapped ->
 *    BrowserWindow created -> out/renderer/index.html loaded from inside
 *    app.asar -> preload contextBridge exposed window.mc -> renderer bundle
 *    executed -> IPC round-tripped renderer->main->renderer. A fresh profile
 *    has no API key, so main answers with its "no API key" error without
 *    touching the network — the smoke test never calls a provider.
 *
 * 2. "first run" — a fresh profile WITHOUT that env var must open the setup
 *    window instead. Evidence: `[setup] window created` and `[setup] wizard
 *    ready` (main logs the latter when the wizard's own renderer completes its
 *    first IPC call, which proves setup.html, its module graph and the
 *    dedicated setup preload all work inside app.asar). MC_E2E_LLM is passed
 *    here too, so the ABSENCE of `[e2e-llm]` proves the main window was never
 *    created and no ASR/sidecar/LLM work was started.
 *
 * Deliberately NOT treated as failure: with onboarding complete the default
 * ASR backend is local-realtime, so scenario 1 always tries to spawn the
 * Python sidecar. On a machine without the conda env that logs a sidecar error
 * and a fatal asrEvent. That is a missing optional dependency, not a broken
 * build.
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
const LLM_MARKER = '[e2e-llm]';
const SETUP_WINDOW_MARKER = '[setup] window created';
const SETUP_READY_MARKER = '[setup] wizard ready';
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

mkdirSync(dirname(logPath), { recursive: true });
const log = createWriteStream(logPath);
console.log(`[smoke] exe  ${exePath}`);
console.log(`[smoke] log  ${logPath}`);

/** taskkill /T so the Python ASR sidecar (a child of electron) dies too */
function killTree(child) {
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

/**
 * Launch the packaged exe once and resolve with everything it printed.
 * `settleMs` keeps collecting after the ready markers appear, so a forbidden
 * marker that would arrive slightly later still gets caught.
 */
function runScenario({ name, env, readyMarkers, settleMs }) {
  const userData = mkdtempSync(join(tmpdir(), 'mc-packaged-smoke-'));
  console.log(`\n[smoke] scenario "${name}" userData ${userData}`);
  log.write(`\n\n===== scenario: ${name} =====\n`);

  return new Promise((resolveRun) => {
    const child = spawn(exePath, [], {
      cwd: dirname(exePath),
      env: { ...process.env, MC_USERDATA: userData, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let output = '';
    let settled = false;
    let timer;
    let settleTimer;

    const finish = (reason) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(settleTimer);
      killTree(child);
      // let the last stdio chunks land before we read the verdict
      setTimeout(() => resolveRun({ name, output, userData, reason }), 800);
    };

    const collect = (chunk) => {
      const text = chunk.toString();
      output += text;
      log.write(text);
      if (settled || settleTimer) return;
      if (FATAL_MARKERS.some((m) => output.includes(m))) finish('fatal');
      else if (readyMarkers.every((m) => output.includes(m))) {
        settleTimer = setTimeout(() => finish('ready'), settleMs);
      }
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);

    timer = setTimeout(() => finish('timeout'), BOOT_TIMEOUT_MS);
    child.on('error', (e) => {
      settled = true;
      clearTimeout(timer);
      clearTimeout(settleTimer);
      fail(`could not launch: ${e.message}`);
    });
    child.on('exit', () => finish('exit'));
  });
}

function check(run, { readyMarkers, forbiddenMarkers }) {
  const tail = run.output.split(/\r?\n/).slice(-25).join('\n');
  const hitFatal = FATAL_MARKERS.filter((m) => run.output.includes(m));
  if (hitFatal.length > 0) {
    fail(`[${run.name}] packaging error in the main process: ${hitFatal.join(', ')}`, tail);
  }
  for (const marker of readyMarkers) {
    if (!run.output.includes(marker)) {
      fail(
        run.reason === 'exit'
          ? `[${run.name}] the app exited before logging "${marker}"`
          : `[${run.name}] no "${marker}" within ${BOOT_TIMEOUT_MS / 1000}s`,
        tail,
      );
    }
  }
  for (const marker of forbiddenMarkers) {
    if (run.output.includes(marker)) {
      fail(`[${run.name}] unexpected "${marker}" — the startup path is wrong`, tail);
    }
  }
  // MC_USERDATA must actually have been honoured, otherwise the run just wrote
  // into the developer's real %APPDATA% profile and proves nothing
  const written = existsSync(run.userData) ? readdirSync(run.userData) : [];
  if (written.length === 0) {
    fail(`[${run.name}] MC_USERDATA was ignored — nothing written to ${run.userData}`, tail);
  }
  console.log(`[smoke] ${run.name}: ok (${written.length} userData entries)`);
  rmSync(run.userData, { recursive: true, force: true });
}

const mainWindowRun = await runScenario({
  name: 'main window',
  env: {
    // pre-wizard developer behaviour: onboarding already complete
    MC_DEV_DEFAULT_LOCAL_ASR: '1',
    // asks main to round-trip one IPC call through the renderer on load
    MC_E2E_LLM: 'packaged smoke test',
  },
  readyMarkers: [LLM_MARKER],
  settleMs: 200,
});
check(mainWindowRun, {
  readyMarkers: [LLM_MARKER],
  forbiddenMarkers: [SETUP_WINDOW_MARKER],
});

const firstRunRun = await runScenario({
  name: 'first run',
  // no MC_DEV_DEFAULT_LOCAL_ASR: a fresh profile must land in the wizard.
  // MC_E2E_LLM is still set so that the absence of its marker is meaningful.
  env: { MC_E2E_LLM: 'packaged smoke test' },
  readyMarkers: [SETUP_WINDOW_MARKER, SETUP_READY_MARKER],
  settleMs: 3000,
});
check(firstRunRun, {
  readyMarkers: [SETUP_WINDOW_MARKER, SETUP_READY_MARKER],
  forbiddenMarkers: [LLM_MARKER],
});

log.end();
const roundTrip = /\[e2e-llm\].*/.exec(mainWindowRun.output)?.[0] ?? '';
console.log(`\n[smoke] ipc round trip   : ${roundTrip.trim()}`);
console.log(`[smoke] sidecar attempted: ${mainWindowRun.output.includes('[sidecar]')} (failure here is not a boot failure)`);
console.log(`[smoke] first-run gating : setup window only, no main-window IPC`);
console.log('\nSMOKE_PACKAGED_OK');
process.exit(0);
