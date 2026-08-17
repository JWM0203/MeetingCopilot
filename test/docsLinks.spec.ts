import { describe, expect, it } from 'vitest';
import { DOCS, allDocUrls, docUrl } from '../shared/docsLinks';
import { isAllowedExternalUrl } from '../electron/externalLinks';

describe('documentation links', () => {
  it('are all openable through the main-process allowlist', () => {
    const urls = allDocUrls();
    expect(urls.length).toBeGreaterThan(10);
    for (const url of urls) expect(isAllowedExternalUrl(url), url).toBe(true);
  });

  it('points every localized doc at a different file per language', () => {
    expect(docUrl(DOCS.quickStart, 'zh')).toContain('QUICK_START.zh-CN.md');
    expect(docUrl(DOCS.quickStart, 'en')).toContain('QUICK_START.en.md');
    expect(docUrl(DOCS.quickStart, 'zh')).not.toBe(docUrl(DOCS.quickStart, 'en'));
  });

  it('returns a single-language doc unchanged', () => {
    // macOS packaging is not shipped yet, so that guide exists in English only
    expect(docUrl(DOCS.installMacos, 'zh')).toBe(DOCS.installMacos);
    expect(docUrl(DOCS.installMacos, 'en')).toBe(DOCS.installMacos);
  });

  it('links the rendered docs, never a raw.githubusercontent path', () => {
    for (const url of allDocUrls()) {
      expect(url.startsWith('https://github.com/JWM0203/MeetingCopilot'), url).toBe(true);
    }
  });
});
