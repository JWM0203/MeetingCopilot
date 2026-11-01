// Exercise Unicode profile paths on every hosted platform, not just ASCII temp directories.
export const SMOKE_PROFILE_PREFIX = 'mc-smoke-会议-';
/** Pure helpers shared by the launcher and its regression tests. */
export const FATAL_MARKERS = [
  'A JavaScript error occurred in the main process', 'Uncaught Exception',
  'Cannot find module', 'MODULE_NOT_FOUND', 'ERR_FILE_NOT_FOUND',
  'Unable to load preload script', 'Failed to load URL', '[smoke-native] failed',
];
export function exitDiagnostic(code, signal) {
  const hex = typeof code === 'number' ? `0x${(code >>> 0).toString(16).toUpperCase().padStart(8, '0')}` : 'none';
  const label = hex === '0xC0000135' ? ' DLL_NOT_FOUND (loader/dependency failure; not a GPU diagnosis)'
    : hex === '0x80000003' ? ' BREAKPOINT (distinct from DLL_NOT_FOUND)' : '';
  return `exit=${code} hex=${hex} signal=${signal ?? 'none'}${label}`;
}
export function smokeFailure({ output, reason, exitCode, signal }, { readyMarkers, forbiddenMarkers = [], ipc = false }) {
  const fatal = FATAL_MARKERS.find((marker) => output.includes(marker));
  if (fatal) return `packaging error: ${fatal}`;
  if (reason !== 'ready') return `did not remain ready: ${reason}; ${exitDiagnostic(exitCode, signal)}`;
  const missing = readyMarkers.find((marker) => !output.includes(marker));
  if (missing) return `missing ready marker: ${missing}`;
  const forbidden = forbiddenMarkers.find((marker) => output.includes(marker));
  if (forbidden) return `unexpected startup marker: ${forbidden}`;
  if (ipc) {
    const match = output.match(/\[e2e-llm\]\s*(\{[^\r\n]*\})/);
    let result;
    try { result = JSON.parse(match?.[1] ?? 'null'); } catch { /* invalid proof */ }
    if (result?.ok !== false || !/API Key not set|未设置 API Key/.test(result?.error ?? '')) {
      return 'IPC did not return the expected no-key error (a thrown hook is not a pass)';
    }
  }
  return null;
}
export function isolatedEnvironment(env) {
  return Object.fromEntries(Object.entries(env).filter(([key]) =>
    !/^MC_/i.test(key) && !/^(ELECTRON_RUN_AS_NODE|NODE_OPTIONS|NODE_PATH)$/i.test(key)));
}
