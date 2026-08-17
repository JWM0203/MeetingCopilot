import { describe, expect, it } from 'vitest';
import {
  candidateKeyTest,
  isTestableTarget,
  orderTestTargets,
  storedKeyTest,
  targetFromPreset,
  type EndpointTarget,
} from '../shared/providerTestRequests';
import { findPresetById } from '../shared/providerCatalog';
import { planDefinition } from '../shared/onboardingPlans';

const llmPreset = findPresetById('deepseek.text.fast')!;
const rtPreset = findPresetById('aliyun.cn.asr.fun-realtime')!;
const geminiPreset = findPresetById('gemini.vision.flash')!;
const customPreset = findPresetById('custom.openai.text')!;

describe('targetFromPreset', () => {
  it('copies the endpoint, the provider and the catalog id', () => {
    expect(targetFromPreset(llmPreset, 'llm')).toEqual({
      capability: 'text-llm',
      providerId: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
      slot: 'llm',
      presetId: 'deepseek.text.fast',
    });
  });

  it('carries the default proxy only when the preset needs one', () => {
    expect(targetFromPreset(geminiPreset, 'vision').proxyUrl).toBe('127.0.0.1:7897');
    expect(targetFromPreset(rtPreset, 'asr-realtime')).not.toHaveProperty('proxyUrl');
  });

  it('keeps the wss endpoint of the verified realtime default untouched', () => {
    const target = targetFromPreset(rtPreset, 'asr-realtime');
    expect(target.baseUrl).toBe('wss://dashscope.aliyuncs.com/api-ws/v1/inference');
    expect(target.model).toBe('fun-asr-realtime');
  });
});

describe('isTestableTarget', () => {
  it('rejects the custom escape hatch until it points somewhere', () => {
    expect(isTestableTarget(targetFromPreset(customPreset, 'llm'))).toBe(false);
  });

  it('accepts a filled-in endpoint', () => {
    expect(isTestableTarget(targetFromPreset(llmPreset, 'llm'))).toBe(true);
  });

  it('treats whitespace-only fields as empty', () => {
    const blank: EndpointTarget = {
      capability: 'text-llm',
      providerId: 'custom',
      baseUrl: '  ',
      model: 'x',
      slot: 'llm',
    };
    expect(isTestableTarget(blank)).toBe(false);
  });
});

describe('candidateKeyTest', () => {
  it('sends the plaintext candidate together with the slot to record into', () => {
    const req = candidateKeyTest(targetFromPreset(llmPreset, 'llm'), 'sk-abc');
    expect(req).toEqual({
      capability: 'text-llm',
      providerId: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
      slot: 'llm',
      presetId: 'deepseek.text.fast',
      candidateApiKey: 'sk-abc',
    });
  });

  it('never sets useStoredKey — a candidate always wins main-side', () => {
    const req = candidateKeyTest(targetFromPreset(rtPreset, 'asr-realtime'), 'sk-abc');
    expect(req.useStoredKey).toBeUndefined();
  });

  it('trims the endpoint so a stray space cannot become a DNS failure', () => {
    const req = candidateKeyTest(
      { ...targetFromPreset(llmPreset, 'llm'), baseUrl: ' https://api.deepseek.com/v1 ' },
      'sk-abc',
    );
    expect(req.baseUrl).toBe('https://api.deepseek.com/v1');
  });
});

describe('storedKeyTest', () => {
  it('always pairs useStoredKey with the slot it reads from', () => {
    const req = storedKeyTest(targetFromPreset(rtPreset, 'asr-realtime'));
    expect(req.useStoredKey).toBe(true);
    expect(req.slot).toBe('asr-realtime');
    expect(req.candidateApiKey).toBeUndefined();
  });

  it('passes the proxy through for vision slots', () => {
    expect(storedKeyTest(targetFromPreset(geminiPreset, 'vision')).proxyUrl).toBe('127.0.0.1:7897');
  });
});

describe('orderTestTargets', () => {
  it('runs the text LLM before the segment ASR for the shared mimo key', () => {
    const def = planDefinition('mimo-simple');
    const ordered = orderTestTargets([
      targetFromPreset(def.asr!.preset, def.asr!.slot),
      targetFromPreset(def.llm!.preset, def.llm!.slot),
    ]);
    expect(ordered.map((t) => t.capability)).toEqual(['text-llm', 'asr-segment']);
  });

  it('does not mutate the input array', () => {
    const input = [targetFromPreset(rtPreset, 'asr-realtime'), targetFromPreset(llmPreset, 'llm')];
    const copy = [...input];
    orderTestTargets(input);
    expect(input).toEqual(copy);
  });

  it('keeps a single target as-is', () => {
    const one = [targetFromPreset(rtPreset, 'asr-realtime')];
    expect(orderTestTargets(one)).toEqual(one);
  });
});
