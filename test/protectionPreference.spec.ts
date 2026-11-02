import { describe, expect, it, vi } from 'vitest';
import { saveProtectionPreference } from '../electron/protectionPreference';
import { applyContentProtection } from '../electron/contentProtection';

describe('next-launch protection preference', () => {
  it.each([true, false])('saves %s without changing current runtime state', next => {
    let saved = !next;
    const actual = !next;
    const result = saveProtectionPreference(next, value => { saved = value; }, () => ({ ui: { stealth: saved }, contentProtection: { actual } }));
    expect(result).toEqual({ ui: { stealth: next }, contentProtection: { actual: !next } });
  });
  it('acknowledges only after save completes', () => {
    const calls: string[] = [];
    saveProtectionPreference(true, () => { calls.push('saved'); }, () => { calls.push('snapshot'); return {}; });
    expect(calls).toEqual(['saved', 'snapshot']);
  });
  it('does not return a success snapshot when persistence fails', () => {
    const snapshot = vi.fn();
    expect(() => saveProtectionPreference(true, () => { throw Error('disk'); }, snapshot)).toThrow('disk');
    expect(snapshot).not.toHaveBeenCalled();
  });
  it('validates input before saving', () => {
    const persist = vi.fn();
    expect(() => saveProtectionPreference('on' as unknown as boolean, persist, () => ({}))).toThrow(TypeError);
    expect(persist).not.toHaveBeenCalled();
  });
  it('keeps desired ON separate from an actual failed startup', () => {
    const preference = true;
    const target = { isDestroyed: () => false, setContentProtection: vi.fn(), isContentProtected: () => false };
    const status = applyContentProtection(target, preference, () => {});
    expect(preference).toBe(true); expect(status).toEqual({ ok: false, requested: true, actual: false, code: 'not-applied' });
  });
});
