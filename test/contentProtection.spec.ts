import { describe, expect, it, vi } from 'vitest';
import { applyContentProtection, readContentProtection, type ProtectionWindow } from '../electron/contentProtection';
function windowFixture(initial: boolean, applies = true) {
  let actual = initial;
  return { isDestroyed: () => false, isContentProtected: () => actual,
    setContentProtection: vi.fn((requested: boolean) => { if (applies) actual = requested; }) };
}
describe('runtime content protection acknowledgement', () => {
  it.each([true, false])('acknowledges and persists actual successful %s', requested => {
    const persist = vi.fn(); const target = windowFixture(!requested);
    expect(applyContentProtection(target, requested, persist)).toEqual({ ok: true, requested, actual: requested });
    expect(persist).toHaveBeenCalledWith(requested);
  });
  it.each([true, false])('rejects observed sticky toggle to %s and persists actual, not requested', requested => {
    const persist = vi.fn(); const target = windowFixture(!requested, false);
    expect(applyContentProtection(target, requested, persist)).toEqual({ ok: false, requested, actual: !requested, code: 'not-applied' });
    expect(persist).toHaveBeenCalledExactlyOnceWith(!requested);
  });
  it('does not silently succeed with missing or destroyed main window', () => {
    const persist = vi.fn();
    for (const target of [null, { ...windowFixture(false), isDestroyed: () => true }]) {
      expect(applyContentProtection(target, true, persist)).toEqual({ ok: false, requested: true, actual: null, code: 'unavailable' });
    }
    expect(persist).not.toHaveBeenCalled();
  });
  it('reports setter exceptions without losing actual state', () => {
    const target = windowFixture(false); target.setContentProtection.mockImplementation(() => { throw Error('native setter'); });
    expect(applyContentProtection(target, true, vi.fn())).toMatchObject({ ok: false, actual: false, code: 'not-applied' });
  });
  it('does not invent an actual state when getter fails', () => {
    const persist = vi.fn(); const target: ProtectionWindow = { ...windowFixture(false), isContentProtected() { throw Error('destroyed'); } };
    expect(applyContentProtection(target, true, persist)).toMatchObject({ ok: false, actual: null, code: 'unavailable' });
    expect(persist).not.toHaveBeenCalled();
  });
  it('reports persistence errors even when runtime changed', () => {
    expect(applyContentProtection(windowFixture(false), true, () => { throw Error('disk'); })).toMatchObject({ ok: false, actual: true, code: 'persistence-failed' });
  });
  it('rejects malformed requests before touching window or settings', () => {
    const target = windowFixture(false); const persist = vi.fn();
    expect(() => applyContentProtection(target, 'yes' as unknown as boolean, persist)).toThrow(TypeError);
    expect(target.setContentProtection).not.toHaveBeenCalled(); expect(persist).not.toHaveBeenCalled();
  });
});

describe('startup/runtime readback', () => {
  it('retains startup mismatch warning and actual state on settings reads', () => {
    const w = windowFixture(false, false);
    const initial = applyContentProtection(w, true, vi.fn());
    expect(readContentProtection(w, initial)).toEqual({ ok: false, requested: true, actual: false, code: 'not-applied' });
  });
  it('returns unknown rather than breaking all settings when window/getter is unavailable', () => {
    const previous = { ok: true, requested: true, actual: true };
    expect(readContentProtection(null, previous)).toMatchObject({ ok: false, actual: null, code: 'unavailable' });
    const w = { ...windowFixture(true), isContentProtected() { throw Error('readback'); } };
    expect(readContentProtection(w, previous)).toMatchObject({ ok: false, actual: null, code: 'unavailable' });
  });
  it('does not silently clear a prior error on a later passive read', () => {
    const previous = { ok: false, requested: true, actual: false, code: 'not-applied' as const };
    expect(readContentProtection(windowFixture(true), previous)).toMatchObject({ ok: false, actual: true });
  });
});
