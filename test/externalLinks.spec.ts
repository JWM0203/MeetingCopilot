import { describe, expect, it } from 'vitest';
import { isAllowedExternalUrl } from '../electron/externalLinks';
import { EXTERNAL_LINK_ALLOWED_HOSTS, PROVIDER_HELP } from '../shared/providerCatalog';

describe('isAllowedExternalUrl', () => {
  it('allows every link the provider catalog actually ships', () => {
    const urls = Object.values(PROVIDER_HELP).flatMap((h) =>
      [h.platformUrl, h.keyUrl, h.docsUrl].filter((u): u is string => typeof u === 'string'),
    );
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) expect(isAllowedExternalUrl(u), u).toBe(true);
  });

  it('allows an allowlisted host with a path, query and fragment', () => {
    expect(isAllowedExternalUrl('https://platform.deepseek.com/api_keys')).toBe(true);
    expect(isAllowedExternalUrl('https://bailian.console.aliyun.com/?tab=model')).toBe(true);
    expect(isAllowedExternalUrl('https://help.aliyun.com/zh/model-studio/get-api-key#step-2')).toBe(
      true,
    );
    expect(isAllowedExternalUrl('https://github.com/JWM0203/MeetingCopilot')).toBe(true);
  });

  it('rejects plain http even on an allowlisted host', () => {
    expect(isAllowedExternalUrl('http://platform.deepseek.com/api_keys')).toBe(false);
  });

  it('rejects javascript:, data: and file: URLs', () => {
    expect(isAllowedExternalUrl('javascript:alert(1)')).toBe(false);
    expect(isAllowedExternalUrl('data:text/html;base64,PHNjcmlwdD4=')).toBe(false);
    expect(isAllowedExternalUrl('file:///C:/Windows/System32/cmd.exe')).toBe(false);
    expect(isAllowedExternalUrl('ms-settings:privacy')).toBe(false);
    expect(isAllowedExternalUrl('vbscript:msgbox(1)')).toBe(false);
  });

  it('rejects subdomain / suffix forgery', () => {
    expect(isAllowedExternalUrl('https://platform.deepseek.com.evil.example/')).toBe(false);
    expect(isAllowedExternalUrl('https://evil-platform.deepseek.com.co/')).toBe(false);
    expect(isAllowedExternalUrl('https://notgithub.com/')).toBe(false);
    // a subdomain of an allowlisted host is still not the allowlisted host
    expect(isAllowedExternalUrl('https://beta.platform.deepseek.com/')).toBe(false);
  });

  it('rejects userinfo tricks in both directions', () => {
    expect(isAllowedExternalUrl('https://platform.deepseek.com@evil.example/')).toBe(false);
    expect(isAllowedExternalUrl('https://evil.example@platform.deepseek.com/')).toBe(false);
    expect(isAllowedExternalUrl('https://user:pass@platform.deepseek.com/')).toBe(false);
  });

  it('rejects a user-entered custom provider URL', () => {
    expect(isAllowedExternalUrl('https://relay.example.com/v1')).toBe(false);
    expect(isAllowedExternalUrl('https://127.0.0.1:7897/')).toBe(false);
  });

  it('rejects garbage input without throwing', () => {
    expect(isAllowedExternalUrl('')).toBe(false);
    expect(isAllowedExternalUrl('not a url')).toBe(false);
    expect(isAllowedExternalUrl(undefined)).toBe(false);
    expect(isAllowedExternalUrl(null)).toBe(false);
    expect(isAllowedExternalUrl(42)).toBe(false);
    expect(isAllowedExternalUrl({ toString: () => 'https://github.com/' })).toBe(false);
    expect(isAllowedExternalUrl(`https://github.com/${'a'.repeat(4096)}`)).toBe(false);
  });

  it('keeps the allowlist to the exact hosts the spec pinned', () => {
    expect([...EXTERNAL_LINK_ALLOWED_HOSTS].sort()).toEqual(
      [
        'ai.google.dev',
        'aistudio.google.com',
        'api-docs.deepseek.com',
        'bailian.console.aliyun.com',
        'github.com',
        'help.aliyun.com',
        'mimo.mi.com',
        'modelstudio.console.aliyun.com',
        'platform.deepseek.com',
        'platform.xiaomimimo.com',
      ].sort(),
    );
  });
});
