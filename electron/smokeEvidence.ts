/** Opt-in, nonce-bound CI evidence. Never used for ordinary application logging. */
import { appendFileSync } from 'fs';
import { isAbsolute, join } from 'path';

export type SmokeEvent = 'setup-window' | 'setup-ipc' | 'native-loaded' | 'llm-ipc' | 'fatal' | 'child-process-gone';
export function writeSmokeEvidence(event: SmokeEvent, details: unknown = null): void {
  const nonce = process.env.MC_SMOKE_NONCE;
  const profile = process.env.MC_USERDATA;
  if (!nonce || !/^[a-f0-9]{64}$/.test(nonce) || !profile || !isAbsolute(profile)) return;
  // MC_USERDATA is created by the launcher before startup. No user-selected
  // filename and no secrets/transcripts/documents are ever passed here.
  appendFileSync(join(profile, 'smoke-evidence.jsonl'), JSON.stringify({
    version: 1, nonce, pid: process.pid, event, details,
  }) + '\n', { encoding: 'utf8', mode: 0o600 });
}
