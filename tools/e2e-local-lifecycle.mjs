/** Verify Electron discovers, starts, connects to, and reaps the local sidecar. */
import { spawn } from 'child_process';
import { createRequire } from 'module';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const electron = require('electron');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const child = spawn(electron, [root], {
  cwd: root,
  env: { ...process.env, MC_E2E_QUIT_ON_ASR_READY: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let output = '';
const collect = (chunk) => {
  const text = chunk.toString();
  output += text;
  process.stdout.write(text);
};
child.stdout.on('data', collect);
child.stderr.on('data', collect);

const timeout = setTimeout(() => {
  console.error('E2E_LOCAL_FAIL: ASR was not ready within 180s');
  child.kill('SIGTERM');
  process.exitCode = 1;
}, 180_000);

child.on('exit', (code) => {
  clearTimeout(timeout);
  const sidecarReady = output.includes('[sidecar] local funasr ready');
  const workerReady = output.includes('[asr] ready ep=cloud-rt');
  const fatal = output.includes('[asr] error (fatal=true)');
  if (code === 0 && sidecarReady && workerReady && !fatal) {
    console.log('E2E_LOCAL_OK');
  } else {
    console.error(
      `E2E_LOCAL_FAIL: exit=${code} sidecarReady=${sidecarReady} workerReady=${workerReady} fatal=${fatal}`,
    );
    process.exitCode = 1;
  }
});
