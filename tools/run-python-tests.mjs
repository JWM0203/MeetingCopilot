import { spawnSync } from 'child_process';

const command = process.platform === 'win32' ? 'py' : 'python3';
const prefix = process.platform === 'win32' ? ['-3'] : [];
const result = spawnSync(
  command,
  [...prefix, '-m', 'unittest', 'discover', '-s', 'test', '-p', 'test_funasr_device.py'],
  { stdio: 'inherit' },
);
if (result.error) {
  console.error(`failed to start ${command}: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
