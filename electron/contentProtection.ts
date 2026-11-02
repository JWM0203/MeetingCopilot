import type { ContentProtectionResult } from '../shared/protocol';

export interface ProtectionWindow {
  isDestroyed(): boolean;
  setContentProtection(enabled: boolean): void;
  isContentProtected(): boolean;
}
/** Electron state is a runtime acknowledgement, NOT proof of capture exclusion. */
export function applyContentProtection(
  target: ProtectionWindow | null,
  requested: boolean,
  persistActual: (actual: boolean) => void,
): ContentProtectionResult {
  if (typeof requested !== 'boolean') throw new TypeError('Content protection requires a boolean');
  if (!target || target.isDestroyed()) return { ok: false, requested, actual: null, code: 'unavailable' };
  let setterFailed = false;
  try { target.setContentProtection(requested); } catch { setterFailed = true; }
  let actual: boolean;
  try { actual = target.isContentProtected(); } catch {
    return { ok: false, requested, actual: null, code: 'unavailable' };
  }
  // Never save an unacknowledged requested state, including a failed OFF request.
  try { persistActual(actual); } catch {
    return { ok: false, requested, actual, code: 'persistence-failed' };
  }
  if (setterFailed || actual !== requested) return { ok: false, requested, actual, code: 'not-applied' };
  return { ok: true, requested, actual };
}

/** Read without changing state; failed change warnings survive until a verified change. */
export function readContentProtection(target: ProtectionWindow | null, previous: ContentProtectionResult): ContentProtectionResult {
  try {
    if (!target || target.isDestroyed()) return { ...previous, ok: false, actual: null, code: 'unavailable' };
    const actual = target.isContentProtected();
    if (actual !== previous.actual) return { ...previous, ok: false, actual, code: 'not-applied' };
    return { ...previous, actual };
  } catch { return { ...previous, ok: false, actual: null, code: 'unavailable' }; }
}
