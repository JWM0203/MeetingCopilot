/** Full Electron renderer -> IPC -> main -> LLM -> renderer smoke. */
import { spawn, execFile } from 'child_process';
import { createRequire } from 'module';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const electron = require('electron');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const question = '用一句话回答：一加一等于几？答案里必须包含阿拉伯数字。';

const child = spawn(electron, [root], {
  cwd: root,
  env: { ...process.env, MC_E2E_LLM: question },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let output = '';
let finished = false;
const collect = (chunk) => {
  const text = chunk.toString();
  output += text;
  process.stdout.write(text);
};
child.stdout.on('data', collect);
child.stderr.on('data', collect);

const stop = () => {
  if (child.exitCode !== null) return;
  if (process.platform === 'win32' && child.pid) {
    execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], () => undefined);
  } else {
    child.kill('SIGTERM');
  }
};

const timeout = setTimeout(() => {
  if (finished) return;
  console.error('E2E_LLM_FAIL: no result within 60s');
  stop();
  process.exitCode = 1;
}, 60_000);

const poll = setInterval(() => {
  const line = output
    .split(/\r?\n/)
    .filter((s) => s.includes('[e2e-llm]'))
    .at(-1);
  if (!line) return;
  finished = true;
  clearTimeout(timeout);
  clearInterval(poll);
  if (/"ok":true/.test(line) && /\d/.test(line)) {
    console.log('E2E_LLM_OK');
  } else {
    console.error(`E2E_LLM_FAIL: ${line}`);
    process.exitCode = 1;
  }
  stop();
}, 250);

child.on('exit', (code) => {
  if (finished) return;
  clearTimeout(timeout);
  clearInterval(poll);
  console.error(`E2E_LLM_FAIL: app exited early (${code})`);
  process.exitCode = 1;
});
