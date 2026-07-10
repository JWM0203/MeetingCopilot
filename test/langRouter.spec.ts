import { describe, expect, it } from 'vitest';
import { LanguageRouter } from '../electron/asr/langRouter';

describe('LanguageRouter', () => {
  it('starts with the configured initial language', () => {
    const r = new LanguageRouter({ initial: 'chinese' });
    expect(r.decide(5000, null)).toBe('chinese');
  });

  it('follows a confident LID result and remembers it', () => {
    const r = new LanguageRouter({ initial: 'chinese', minMargin: 1.0 });
    expect(r.decide(5000, { lang: 'english', margin: 4.2 })).toBe('english');
    // next short segment (no LID) sticks to english
    expect(r.decide(600, null)).toBe('english');
  });

  it('ignores low-confidence LID and stays sticky', () => {
    const r = new LanguageRouter({ initial: 'chinese', minMargin: 1.0 });
    expect(r.decide(5000, { lang: 'english', margin: 0.3 })).toBe('chinese');
    expect(r.decide(5000, { lang: 'english', margin: 0.99 })).toBe('chinese');
  });

  it('switches back and forth on confident results (code-switch meetings)', () => {
    const r = new LanguageRouter({ initial: 'chinese' });
    expect(r.decide(4000, { lang: 'english', margin: 5 })).toBe('english');
    expect(r.decide(4000, { lang: 'chinese', margin: 5 })).toBe('chinese');
    expect(r.decide(4000, { lang: 'english', margin: 5 })).toBe('english');
  });

  it('shouldRunLid gates by minimum audio length', () => {
    const r = new LanguageRouter({ minAudioMsForLid: 1200 });
    expect(r.shouldRunLid(800)).toBe(false);
    expect(r.shouldRunLid(1200)).toBe(true);
    expect(r.shouldRunLid(5000)).toBe(true);
  });

  it('short segments never trigger a language flip', () => {
    const r = new LanguageRouter({ initial: 'chinese', minAudioMsForLid: 1200 });
    // caller respects shouldRunLid and passes null for short audio
    expect(r.decide(800, null)).toBe('chinese');
    expect(r.decide(900, null)).toBe('chinese');
  });
});
