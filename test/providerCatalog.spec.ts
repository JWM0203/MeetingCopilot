import { describe, expect, it } from 'vitest';
import {
  EXTERNAL_LINK_ALLOWED_HOSTS,
  LOCAL_REALTIME_MODELS,
  PROVIDER_HELP,
  PROVIDER_PRESETS,
  findPresetByEndpoint,
  findPresetById,
  presetsForCapability,
  providerIdForEndpoint,
  type ProviderHelp,
} from '../shared/providerCatalog';

const urlFields: (keyof ProviderHelp)[] = ['platformUrl', 'keyUrl', 'docsUrl'];

function helpUrls(help: ProviderHelp): string[] {
  return urlFields.map((f) => help[f]).filter((v): v is string => typeof v === 'string');
}

describe('providerCatalog', () => {
  it('has unique, stable preset ids', () => {
    const ids = PROVIDER_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('ships the stable ids the wizard and settings depend on', () => {
    for (const id of [
      'deepseek.text.fast',
      'deepseek.text.thinking',
      'deepseek.text.deep',
      'aliyun.cn.asr.fun-realtime',
      'aliyun.cn.asr.paraformer-realtime-v2',
      'mimo.text.fast',
      'mimo.asr.segment',
      'mimo.vision',
      'gemini.vision.flash',
      'custom.openai.text',
    ]) {
      expect(findPresetById(id), `missing preset ${id}`).toBeTruthy();
    }
  });

  it('gives every preset a zh and an en name plus a description', () => {
    for (const p of PROVIDER_PRESETS) {
      expect(p.nameZh.length, p.id).toBeGreaterThan(0);
      expect(p.nameEn.length, p.id).toBeGreaterThan(0);
      expect(p.descriptionZh.length, p.id).toBeGreaterThan(0);
      expect(p.descriptionEn.length, p.id).toBeGreaterThan(0);
    }
  });

  it('gives every non-custom preset a non-empty baseUrl and model', () => {
    for (const p of PROVIDER_PRESETS) {
      if (p.providerId === 'custom') continue;
      expect(p.baseUrl.length, p.id).toBeGreaterThan(0);
      expect(p.model.length, p.id).toBeGreaterThan(0);
    }
  });

  it('recommends exactly one preset per onboarding capability', () => {
    const recommendedText = presetsForCapability('text-llm').filter((p) => p.recommended);
    const recommendedAsr = presetsForCapability('asr-realtime').filter((p) => p.recommended);
    expect(recommendedText.map((p) => p.id)).toEqual(['deepseek.text.fast']);
    expect(recommendedAsr.map((p) => p.id)).toEqual(['aliyun.cn.asr.fun-realtime']);
  });

  it('gives recommended presets real help links and tutorial steps', () => {
    for (const p of PROVIDER_PRESETS.filter((x) => x.recommended)) {
      expect(p.help.keyUrl, p.id).toBeTruthy();
      expect(p.help.docsUrl, p.id).toBeTruthy();
      expect(p.help.stepsZh.length, p.id).toBeGreaterThan(2);
      expect(p.help.stepsEn.length, p.id).toBe(p.help.stepsZh.length);
    }
  });

  it('keeps zh and en tutorials in lockstep for every provider', () => {
    for (const [providerId, help] of Object.entries(PROVIDER_HELP)) {
      expect(help.stepsZh.length, providerId).toBeGreaterThan(0);
      expect(help.stepsEn.length, providerId).toBe(help.stepsZh.length);
      expect(help.stepsZh.every((s) => s.trim().length > 0), providerId).toBe(true);
      expect(help.stepsEn.every((s) => s.trim().length > 0), providerId).toBe(true);
      if (help.faqZh || help.faqEn) {
        expect(help.faqEn?.length, providerId).toBe(help.faqZh?.length);
      }
      if (help.billingHintZh || help.billingHintEn) {
        expect(help.billingHintZh, providerId).toBeTruthy();
        expect(help.billingHintEn, providerId).toBeTruthy();
      }
    }
  });

  it('only links to https URLs whose hostname is on the external-link allowlist', () => {
    const urls = [
      ...PROVIDER_PRESETS.flatMap((p) => helpUrls(p.help)),
      ...Object.values(PROVIDER_HELP).flatMap(helpUrls),
    ];
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) {
      const parsed = new URL(u);
      expect(parsed.protocol, u).toBe('https:');
      expect(EXTERNAL_LINK_ALLOWED_HOSTS, u).toContain(parsed.hostname);
    }
  });

  it('matches the values that used to be hardcoded in SettingsPanel', () => {
    expect(findPresetById('deepseek.text.fast')).toMatchObject({
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
    });
    expect(findPresetById('aliyun.cn.asr.fun-realtime')).toMatchObject({
      baseUrl: 'wss://dashscope.aliyuncs.com/api-ws/v1/inference',
      model: 'fun-asr-realtime',
    });
    expect(findPresetById('mimo.asr.segment')).toMatchObject({
      baseUrl: 'https://api.xiaomimimo.com/v1',
      model: 'mimo-v2.5-asr',
      beta: true,
    });
    expect(findPresetById('gemini.vision.flash')).toMatchObject({
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      model: 'gemini-2.5-flash',
      defaultProxyUrl: '127.0.0.1:7897',
    });
    expect(LOCAL_REALTIME_MODELS.map((m) => m.value)).toEqual([
      'fun-asr-nano',
      'paraformer-zh-streaming',
      'moss-transcribe-diarize',
    ]);
  });

  it('resolves an endpoint pair to its provider, ignoring trailing slashes', () => {
    expect(providerIdForEndpoint('https://api.deepseek.com/v1', 'deepseek-chat')).toBe('deepseek');
    expect(providerIdForEndpoint('https://api.deepseek.com/v1/', 'deepseek-chat')).toBe('deepseek');
    expect(
      providerIdForEndpoint('wss://dashscope.aliyuncs.com/api-ws/v1/inference', 'fun-asr-realtime'),
    ).toBe('aliyun-dashscope-cn');
  });

  it('treats unknown or partially matching endpoints as custom', () => {
    expect(providerIdForEndpoint('https://api.deepseek.com/v1', 'some-other-model')).toBe('custom');
    expect(providerIdForEndpoint('https://relay.example.com/v1', 'deepseek-chat')).toBe('custom');
    expect(providerIdForEndpoint(undefined, 'deepseek-chat')).toBe('custom');
    expect(providerIdForEndpoint('https://api.deepseek.com/v1', undefined)).toBe('custom');
    // no substring matching: a lookalike host must not resolve to DeepSeek
    expect(providerIdForEndpoint('https://evil.example/api.deepseek.com/v1', 'deepseek-chat')).toBe(
      'custom',
    );
  });

  it('can scope endpoint lookup by capability', () => {
    expect(
      findPresetByEndpoint('https://api.xiaomimimo.com/v1', 'mimo-v2.5-asr', 'asr-segment')?.id,
    ).toBe('mimo.asr.segment');
    expect(
      findPresetByEndpoint('https://api.xiaomimimo.com/v1', 'mimo-v2.5-asr', 'text-llm'),
    ).toBeUndefined();
  });
});
