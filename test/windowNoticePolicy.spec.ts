import { describe, expect, it } from 'vitest';
import { shouldNotifyWindowHidden } from '../shared/windowNoticePolicy';
const ordinary = { trayExists: true, alreadyShown: false, actualProtection: false, protectionRequested: false };
describe('own-app hidden-window notification policy', () => {
  it('retains the one-time reopening hint in verified ordinary mode', () => {
    expect(shouldNotifyWindowHidden(ordinary)).toBe(true);
    expect(shouldNotifyWindowHidden({ ...ordinary, alreadyShown: true })).toBe(false);
    expect(shouldNotifyWindowHidden({ ...ordinary, trayExists: false })).toBe(false);
  });
  it.each([true, null])('does not emit an OS toast for actual protection %s', actualProtection => {
    expect(shouldNotifyWindowHidden({ ...ordinary, actualProtection })).toBe(false);
  });
  it('does not expose an extra toast after a failed protection request', () => {
    expect(shouldNotifyWindowHidden({ ...ordinary, protectionRequested: true })).toBe(false);
  });
  it('uses runtime truth even when saved/requested setting says OFF', () => {
    expect(shouldNotifyWindowHidden({ ...ordinary, actualProtection: true, protectionRequested: false })).toBe(false);
  });
});
