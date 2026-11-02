import { describe, expect, it } from 'vitest';
import { clampOpacity, OPACITY_DEFAULT, OPACITY_MAX, OPACITY_MIN } from '../shared/opacity';
describe('preserved transparent panel controls', () => {
  it('keeps the transferred default and range', () => {
    expect(OPACITY_DEFAULT).toBe(0.55); expect(OPACITY_MIN).toBe(0.15); expect(OPACITY_MAX).toBe(1);
  });
  it('bounds settings without allowing invisible or invalid panels', () => {
    expect(clampOpacity(-1)).toBe(OPACITY_MIN); expect(clampOpacity(2)).toBe(OPACITY_MAX);
    expect(clampOpacity(NaN)).toBe(OPACITY_DEFAULT); expect(clampOpacity(Infinity)).toBe(OPACITY_DEFAULT);
    expect(clampOpacity(0.3)).toBe(0.3);
  });
});
