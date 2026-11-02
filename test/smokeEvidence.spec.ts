import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { writeSmokeEvidence } from '../electron/smokeEvidence';
// @ts-expect-error standalone Node helper
import { readSmokeEvidence } from '../tools/smoke-evidence.mjs';
const nonce = 'a'.repeat(64);
const record = (event: string, details: unknown = null, overrides = {}) => JSON.stringify({ version: 1, nonce, pid: 123, event, details, ...overrides }) + '\n';
const profiles: string[] = [];
const oldNonce = process.env.MC_SMOKE_NONCE, oldProfile = process.env.MC_USERDATA;
afterEach(() => {
  if (oldNonce === undefined) delete process.env.MC_SMOKE_NONCE; else process.env.MC_SMOKE_NONCE = oldNonce;
  if (oldProfile === undefined) delete process.env.MC_USERDATA; else process.env.MC_USERDATA = oldProfile;
  for (const profile of profiles.splice(0)) rmSync(profile, { recursive: true, force: true });
});
describe('nonce-bound application smoke evidence', () => {
  it('requires both real setup callbacks, not a process-exists marker', () => {
    expect(readSmokeEvidence(record('setup-window'), nonce, false).ready).toBe(false);
    expect(readSmokeEvidence(record('setup-window') + record('setup-ipc'), nonce, false).ready).toBe(true);
  });
  it('requires native load plus actual expected no-key IPC response', () => {
    const ipc = record('llm-ipc', { ok: false, error: 'API Key not set' });
    expect(readSmokeEvidence(ipc, nonce, true).ready).toBe(false);
    expect(readSmokeEvidence(record('native-loaded') + ipc, nonce, true).ready).toBe(true);
    expect(() => readSmokeEvidence(record('llm-ipc', { ok: true }), nonce, true)).toThrow('no-key');
  });
  it('rejects stale nonces, mixed processes, wrong startup and crashes', () => {
    expect(() => readSmokeEvidence(record('setup-ipc', null, { nonce: 'b'.repeat(64) }), nonce, false)).toThrow('stale');
    expect(() => readSmokeEvidence(record('setup-window') + record('setup-ipc', null, { pid: 999 }), nonce, false)).toThrow('Mixed');
    expect(() => readSmokeEvidence(record('setup-window'), nonce, true)).toThrow('startup');
    expect(() => readSmokeEvidence(record('fatal', { stage: 'renderer-gone' }), nonce, false)).toThrow('failure');
  });
  it('does not accept a partial append as readiness', () => {
    expect(readSmokeEvidence(record('setup-window') + record('setup-ipc').trimEnd(), nonce, false).ready).toBe(false);
    expect(() => readSmokeEvidence('invalid\n', nonce, false)).toThrow('Malformed');
  });
  it('writes only opt-in evidence in the private profile with current pid', () => {
    const profile = mkdtempSync(join(tmpdir(), 'mc-evidence-test-')); profiles.push(profile);
    process.env.MC_USERDATA = profile; process.env.MC_SMOKE_NONCE = nonce;
    writeSmokeEvidence('setup-window'); writeSmokeEvidence('setup-ipc');
    const parsed = readSmokeEvidence(readFileSync(join(profile, 'smoke-evidence.jsonl'), 'utf8'), nonce, false);
    expect(parsed).toMatchObject({ ready: true, pid: process.pid });
  });
});
