/**
 * Overlay panel opacity (ui.opacity). Drives the alpha channel of the main
 * panel background only — text, buttons and inputs stay fully opaque so the
 * copilot remains readable over any desktop content.
 *
 * Shared by the settings store (validation on load / patch) and the renderer
 * (slider bounds + live preview) so both sides agree on the range.
 */
export const OPACITY_MIN = 0.15;
export const OPACITY_MAX = 1;
export const OPACITY_STEP = 0.05;
/** new default: a light, mostly see-through panel (user request 2026-09-22) */
export const OPACITY_DEFAULT = 0.55;
/**
 * Value every profile carried before the slider existed. It was written to
 * disk by defaultSettings() but never applied anywhere, so it does not encode
 * a user choice: the loader resets it to the new default.
 */
export const OPACITY_LEGACY_UNUSED = 0.94;

/** Clamp to [OPACITY_MIN, OPACITY_MAX]; non-finite input falls back to the default. */
export function clampOpacity(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return OPACITY_DEFAULT;
  return Math.min(OPACITY_MAX, Math.max(OPACITY_MIN, n));
}
