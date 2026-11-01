import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error standalone Node smoke helper has no declaration file
import { SMOKE_PROFILE_PREFIX, exitDiagnostic, isolatedEnvironment, smokeFailure } from '../tools/smoke-verdict.mjs';
const scenario = { readyMarkers: ['[e2e-llm]'], ipc: true };
const good = { output: '[e2e-llm] {"ok":false,"error":"API Key not set — add one in Settings and retry"}', reason: 'ready' };
describe('boot smoke verdict', () => {
  it('requires genuine expected IPC response', () => {
    expect(smokeFailure(good, scenario)).toBeNull();
    expect(smokeFailure({ ...good, output: '[e2e-llm] threw bridge missing' }, scenario)).toContain('IPC');
    expect(smokeFailure({ ...good, output: '[e2e-llm] {"ok":true}' }, scenario)).toContain('IPC');
  });
  it('rejects exit after readiness and late packaging failures', () => {
    expect(smokeFailure({ ...good, reason: 'exit', exitCode: 0 }, scenario)).toContain('exit');
    expect(smokeFailure({ ...good, output: good.output + '\nMODULE_NOT_FOUND' }, scenario)).toContain('packaging');
  });
  it('requires the real native-module load marker and rejects load failures', () => {
    const nativeScenario = { ...scenario, readyMarkers: [...scenario.readyMarkers, '[smoke-native] loaded'] };
    expect(smokeFailure(good, nativeScenario)).toContain('missing ready marker');
    expect(smokeFailure({ ...good, output: good.output + '\n[smoke-native] loaded' }, nativeScenario)).toBeNull();
    expect(smokeFailure({ ...good, output: good.output + '\n[smoke-native] failed ERR_DLOPEN_FAILED' }, nativeScenario)).toContain('packaging error');
  });
  it('distinguishes loader failure from breakpoint', () => {
    expect(exitDiagnostic(-1073741515)).toContain('0xC0000135');
    expect(exitDiagnostic(-1073741515)).toContain('DLL_NOT_FOUND');
    expect(exitDiagnostic(-2147483645)).toContain('BREAKPOINT');
  });
  it('removes ambient test hooks and node injection', () => {
    expect(isolatedEnvironment({ PATH: '/bin', MC_DEV_DEFAULT_LOCAL_ASR: '1', MC_E2E_SHOT: 'x', ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: 'x' })).toEqual({ PATH: '/bin' });
  });
});

it('exercises real non-ASCII profile and Windows installation paths', () => {
  expect(SMOKE_PROFILE_PREFIX).toMatch(/[^\x00-\x7f]/);
  const dir = mkdtempSync(join(tmpdir(), SMOKE_PROFILE_PREFIX));
  try { expect(existsSync(dir)).toBe(true); }
  finally { rmSync(dir, { recursive: true, force: true }); }
  const windowsScript = readFileSync(join(__dirname, '..', 'tools', 'windows-package-smoke.ps1'), 'utf8');
  expect(windowsScript).toContain("'mc installer smoke 会议'");
});
