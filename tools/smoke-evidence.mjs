/** Validate evidence written by real Electron callbacks, independently of launcher stdio. */
export function readSmokeEvidence(text, nonce, ipc) {
  const records = [];
  // Ignore an incomplete last append while the process is still writing.
  for (const line of text.split('\n').slice(0, -1)) {
    if (!line) continue;
    let record;
    try { record = JSON.parse(line); } catch { throw new Error('Malformed smoke evidence'); }
    if (record.version !== 1 || record.nonce !== nonce || !Number.isSafeInteger(record.pid) || record.pid <= 0) {
      throw new Error('Untrusted/stale smoke evidence');
    }
    if (records.length && record.pid !== records[0].pid) throw new Error('Mixed application processes in smoke evidence');
    records.push(record);
  }
  const has = (event) => records.some((record) => record.event === event);
  const fatal = records.find((record) => record.event === 'fatal');
  if (fatal) throw new Error(`Application failure evidence: ${JSON.stringify(fatal.details)}`);
  if (ipc && (has('setup-window') || has('setup-ipc'))) throw new Error('Unexpected setup startup path');
  if (!ipc && has('llm-ipc')) throw new Error('Unexpected main-window IPC');
  const reply = records.find((record) => record.event === 'llm-ipc')?.details;
  if (reply && (reply.ok !== false || !/API Key not set|未设置 API Key/.test(reply.error ?? ''))) {
    throw new Error('Unexpected no-key IPC reply');
  }
  const ready = ipc ? has('native-loaded') && !!reply : has('setup-window') && has('setup-ipc');
  const output = records.map(({ event, details }) => {
    if (event === 'setup-window') return '[setup] window created';
    if (event === 'setup-ipc') return '[setup] wizard ready';
    if (event === 'native-loaded') return '[smoke-native] loaded';
    if (event === 'llm-ipc') return `[e2e-llm] ${JSON.stringify(details)}`;
    return `[smoke-evidence] ${event} ${JSON.stringify(details)}`;
  }).join('\n');
  return { ready, pid: records[0]?.pid, output };
}
