/** No-secret source/packaged boot + preload + IPC gate. No GPU bypass. */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { readSmokeEvidence } from './smoke-evidence.mjs';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { SMOKE_PROFILE_PREFIX, FATAL_MARKERS, exitDiagnostic, isolatedEnvironment, smokeFailure } from './smoke-verdict.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const value = (flag, fallback) => args.includes(flag) ? args[args.indexOf(flag) + 1] : fallback;
const source = args.includes('--source');
const defaults = {
  win32: 'release/win-unpacked/MeetingCopilot.exe',
  linux: 'release/linux-unpacked/meeting-copilot',
  darwin: `release/mac${process.arch === 'arm64' ? '-arm64' : ''}/MeetingCopilot.app/Contents/MacOS/MeetingCopilot`,
};
const exe = source ? createRequire(import.meta.url)('electron') : resolve(root, value('--exe', defaults[process.platform]));
const label = value('--label', source ? 'source' : 'unpacked');
if (!/^[a-z0-9-]+$/i.test(label)) throw new Error('invalid --label');
const logDir = join(root, 'release', 'smoke');
mkdirSync(logDir, { recursive: true });
const logPath = join(logDir, `${label}.log`);
writeFileSync(logPath, `platform=${process.platform} arch=${process.arch} node=${process.version}\nexe=${exe}\n`);
const log = (text) => appendFileSync(logPath, text);
if (!existsSync(exe)) throw new Error(`SMOKE_FAIL: not built: ${exe}`);
// Inventory adjacent loader payloads, not environment variables or user files.
writeFileSync(join(logDir, `${label}-inventory.json`), JSON.stringify(readdirSync(dirname(exe)).sort(), null, 2));
const timeoutMs = 90_000; // portable extraction on a cold hosted runner can be slow
function killTree(child) {
  if (!child.pid) return;
  try {
    if (process.platform === 'win32') execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else process.kill(-child.pid, 'SIGKILL');
  } catch { try { child.kill('SIGKILL'); } catch { /* already gone */ } }
}
async function runScenario(scenario) {
  const nonce = randomBytes(32).toString('hex');
  const userData = mkdtempSync(join(tmpdir(), SMOKE_PROFILE_PREFIX));
  // Explicit unconfigured cloud backend: no model download, sidecar, key, or provider request.
  if (scenario.ipc) writeFileSync(join(userData, 'settings.json'), JSON.stringify({
    version: 2, onboarding: { schemaVersion: 1, completed: true },
    asr: { backend: 'cloud' }, ui: { lang: 'en', autoLaunch: false },
  }));
  log(`\n===== ${scenario.name} =====\n`);
  const evidencePath = join(userData, 'smoke-evidence.jsonl');
  let child, actualPid, cleaned = false;
  const inheritedEnv = isolatedEnvironment(process.env);
  for (const key of Object.keys(inheritedEnv)) {
    if (key.toUpperCase() === 'ELECTRON_RENDERER_URL') delete inheritedEnv[key];
  }
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    if (child) killTree(child);
    // NSIS may have exited before its child. Only a nonce-validated application
    // PID is eligible for this fallback; never kill by executable name.
    if (actualPid && actualPid !== child?.pid) {
      try {
        if (process.platform === 'win32') execFileSync('taskkill', ['/pid', String(actualPid), '/T', '/F'], { stdio: 'ignore' });
        else process.kill(actualPid, 'SIGKILL');
      } catch { /* already reaped by the wrapper's process tree */ }
    }
  };
  try {
    const result = await new Promise((resolveRun) => {
      let output = '', done = false, settleTimer, evidenceTimer, exitCode = null, signal = null;
      let evidence = { ready: false, output: '', pid: undefined };
      const finish = (reason) => {
        if (done) return;
        done = true;
        clearTimeout(timer); clearTimeout(settleTimer); clearInterval(evidenceTimer);
        log(`[smoke] cleanup begins reason=${reason} at=${new Date().toISOString()}\n`);
        cleanup();
        setTimeout(() => resolveRun({ output: output + '\n' + evidence.output, reason, exitCode, signal }), 800);
      };
      const timer = setTimeout(() => finish('timeout'), timeoutMs);
      child = spawn(exe, source ? [root] : [], {
        cwd: dirname(exe), detached: process.platform !== 'win32', windowsHide: true,
        env: { ...inheritedEnv, MC_USERDATA: userData, MC_SMOKE_NONCE: nonce, MC_E2E_LLM: 'no-secret smoke', ...(scenario.ipc ? { MC_SMOKE_NATIVE: '1' } : {}) },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const collect = (chunk) => {
        const text = chunk.toString(); output += text; log(text);
        if (done) return;
        if (FATAL_MARKERS.some((marker) => output.includes(marker))) return finish('fatal');
      };
      const inspectEvidence = () => {
        if (done || !existsSync(evidencePath)) return;
        try {
          evidence = readSmokeEvidence(readFileSync(evidencePath, 'utf8'), nonce, !!scenario.ipc);
          actualPid = evidence.pid;
          if (evidence.pid) process.kill(evidence.pid, 0); // real app, not just the NSIS wrapper
          if (evidence.ready && !settleTimer) {
            log(`[smoke] nonce-bound IPC evidence ready pid=${evidence.pid} at=${new Date().toISOString()}\n`);
            settleTimer = setTimeout(() => {
              inspectEvidence();
              if (!done && evidence.ready) finish('ready');
            }, 3000);
          }
        } catch (error) {
          log(`evidence failure: ${error.message}\n`);
          finish('evidence-failure');
        }
      };
      evidenceTimer = setInterval(inspectEvidence, 100);
      child.stdout.on('data', collect); child.stderr.on('data', collect);
      child.on('error', (error) => { log(`spawn error: ${error.message}\n`); finish('spawn-error'); });
      child.on('exit', (code, sig) => {
        // Do not turn our intentional cleanup kill into an application crash.
        if (!done) {
          // Capture a validated child PID for cleanup even if the launcher exits
          // before the first polling tick. Exit remains a failure, never a pass.
          inspectEvidence();
          exitCode = code; signal = sig; log(`${exitDiagnostic(code, sig)}\n`); finish('exit');
        }
      });
    });
    if (existsSync(evidencePath)) {
      // Nonce removed from uploaded evidence; never upload the complete profile.
      const evidenceLog = readFileSync(evidencePath, 'utf8').replaceAll(nonce, '<nonce>');
      writeFileSync(join(logDir, `${label}-${scenario.ipc ? 'main' : 'setup'}-evidence.jsonl`), evidenceLog);
      log(`\n[evidence]\n${evidenceLog}`);
    }
    const failure = smokeFailure(result, scenario);
    if (failure) throw new Error(`${scenario.name}: ${failure}\n${result.output.split(/\r?\n/).slice(-25).join('\n')}`);
    if (!readdirSync(userData).some((name) => name !== 'settings.json' && name !== 'smoke-evidence.jsonl')) throw new Error('MC_USERDATA not honored: no runtime files');
    console.log(`SMOKE_OK ${label}: ${scenario.name}`);
  } finally {
    cleanup();
    rmSync(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  }
}
try {
  await runScenario({ name: 'first run', readyMarkers: ['[setup] window created', '[setup] wizard ready'], forbiddenMarkers: ['[e2e-llm]'] });
  await runScenario({ name: 'main window IPC', readyMarkers: ['[e2e-llm]', '[smoke-native] loaded'], forbiddenMarkers: ['[setup] window created'], ipc: true });
  log('SMOKE_OK\n');
  console.log('SKIP: native inference/GPU execution, paid providers, ASR models, physical audio, OS privacy prompts, screen-share exclusion, signing/notarization; not covered by boot smoke.');
} catch (error) {
  log(`SMOKE_FAIL: ${error.message}\n`);
  console.error(`SMOKE_FAIL ${label}: ${error.message}\nFull log: ${logPath}`);
  process.exitCode = 1;
}
