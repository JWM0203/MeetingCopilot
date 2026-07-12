import { spawnSync } from 'child_process';

// Try interpreters in order: explicit override, then platform-typical names.
// The `py` launcher only ships with the python.org installer, so conda-only
// Windows machines fall through to plain `python`.
const candidates = process.env.MC_PYTHON
  ? [[process.env.MC_PYTHON, []]]
  : process.platform === 'win32'
    ? [['py', ['-3']], ['python', []]]
    : [['python3', []], ['python', []]];

const testArgs = ['-m', 'unittest', 'discover', '-s', 'test', '-p', 'test_funasr_device.py'];
let lastError = null;
for (const [command, prefix] of candidates) {
  const result = spawnSync(command, [...prefix, ...testArgs], { stdio: 'inherit' });
  if (!result.error) process.exit(result.status ?? 1);
  lastError = `${command}: ${result.error.message}`;
}
console.error(`no usable Python found (${lastError}); set MC_PYTHON to your interpreter`);
process.exit(1);
