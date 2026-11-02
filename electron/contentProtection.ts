import type { ContentProtectionResult } from '../shared/protocol';

export interface ProtectionWindow {
  isDestroyed(): boolean;
  getOpacity(): number;
  setOpacity(opacity: number): void;
  setContentProtection(enabled: boolean): void;
  isContentProtected(): boolean;
}
/** Electron state is a runtime acknowledgement, NOT proof of capture exclusion. */
export function applyContentProtection(
  target: ProtectionWindow | null,
  requested: boolean,
  persistActual: (actual: boolean) => void,
  platform: NodeJS.Platform = process.platform,
): ContentProtectionResult {
  if (typeof requested !== 'boolean') throw new TypeError('Content protection requires a boolean');
  if (!target || target.isDestroyed()) return { ok: false, requested, actual: null, code: 'unavailable' };
  let setterFailed = false;
  try {
    if (platform === 'win32') {
      // Re-establish Electron's layered-window attributes before changing capture
      // affinity. Keep native opacity unchanged; panel alpha remains renderer CSS.
      const opacity = target.getOpacity();
      if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) throw new Error('Invalid native opacity');
      target.setOpacity(opacity);
      if (target.getOpacity() !== opacity) throw new Error('Native opacity changed unexpectedly');
    }
    target.setContentProtection(requested);
  } catch { setterFailed = true; }
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
