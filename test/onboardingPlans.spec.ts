import { describe, expect, it } from 'vitest';
import {
  PLAN_PRESET_IDS,
  buildPlanPatch,
  keyPatchForSlot,
  mergeKeyPatches,
  planDefinition,
} from '../shared/onboardingPlans';
import { findPresetById } from '../shared/providerCatalog';

describe('onboarding plan definitions', () => {
  it('resolves every plan preset from the catalog', () => {
    for (const id of Object.values(PLAN_PRESET_IDS)) {
      expect(findPresetById(id), id).toBeDefined();
    }
  });

  it('wires the recommended plan to realtime ASR + a text LLM', () => {
    const def = planDefinition('recommended');
    expect(def.backend).toBe('cloud-realtime');
    expect(def.asr?.slot).toBe('asr-realtime');
    expect(def.asr?.preset.id).toBe(PLAN_PRESET_IDS.asrRealtime);
    expect(def.llm?.preset.id).toBe(PLAN_PRESET_IDS.llmDeepseek);
    expect(def.canShareKey).toBe(false);
  });

  it('wires the minimal plan to segment ASR on one provider', () => {
    const def = planDefinition('mimo-simple');
    expect(def.backend).toBe('cloud');
    expect(def.asr?.slot).toBe('asr-cloud');
    expect(def.llm?.slot).toBe('llm');
    // both slots live on the same provider, which is what makes reuse possible
    expect(def.asr?.preset.providerId).toBe(def.llm?.preset.providerId);
    expect(def.canShareKey).toBe(true);
  });

  it('leaves the LLM unconfigured for transcription-only', () => {
    const def = planDefinition('transcription-only');
    expect(def.asr?.slot).toBe('asr-realtime');
    expect(def.llm).toBeUndefined();
  });

  it('configures nothing for the advanced escape hatch', () => {
    const def = planDefinition('advanced');
    expect(def.asr).toBeUndefined();
    expect(def.llm).toBeUndefined();
    expect(def.backend).toBeUndefined();
  });
});

describe('buildPlanPatch', () => {
  const opts = { micEnabled: false, micDeviceId: '', lang: 'zh' as const };

  it('copies endpoints from the catalog rather than hardcoding them', () => {
    const asr = findPresetById(PLAN_PRESET_IDS.asrRealtime)!;
    const llm = findPresetById(PLAN_PRESET_IDS.llmDeepseek)!;
    const patch = buildPlanPatch('recommended', opts);
    expect(patch.asr).toEqual({
      backend: 'cloud-realtime',
      providerId: asr.providerId,
      realtime: { baseUrl: asr.baseUrl, model: asr.model },
    });
    expect(patch.llm).toEqual({
      baseUrl: llm.baseUrl,
      model: llm.model,
      providerId: llm.providerId,
    });
  });

  it('uses the segment slot for the minimal plan', () => {
    const patch = buildPlanPatch('mimo-simple', opts);
    expect(patch.asr?.backend).toBe('cloud');
    expect(patch.asr?.cloud?.model).toBe(findPresetById(PLAN_PRESET_IDS.asrSegment)!.model);
    expect(patch.asr?.realtime).toBeUndefined();
  });

  it('omits the llm section for transcription-only', () => {
    expect(buildPlanPatch('transcription-only', opts).llm).toBeUndefined();
  });

  it('changes no provider setting for the advanced plan', () => {
    const patch = buildPlanPatch('advanced', opts);
    expect(patch.asr).toBeUndefined();
    expect(patch.llm).toBeUndefined();
  });

  it('carries the audio + ui choices', () => {
    const patch = buildPlanPatch('recommended', {
      micEnabled: true,
      micDeviceId: 'mic-1',
      themDeviceId: 'blackhole',
      lang: 'en',
    });
    expect(patch.audio).toEqual({
      micEnabled: true,
      micDeviceId: 'mic-1',
      themDeviceId: 'blackhole',
    });
    expect(patch.ui).toEqual({ lang: 'en' });
  });

  it('never leaks a key into the plan patch', () => {
    const json = JSON.stringify(buildPlanPatch('mimo-simple', opts));
    expect(json).not.toContain('apiKey');
  });
});

describe('key patches', () => {
  it('targets one slot at a time', () => {
    expect(keyPatchForSlot('llm', 'sk-a')).toEqual({ llm: { apiKey: 'sk-a' } });
    expect(keyPatchForSlot('asr-cloud', 'sk-a')).toEqual({ asr: { cloud: { apiKey: 'sk-a' } } });
    expect(keyPatchForSlot('asr-realtime', 'sk-a')).toEqual({
      asr: { realtime: { apiKey: 'sk-a' } },
    });
  });

  it('merges a shared key into ONE patch so each slot is encrypted separately', () => {
    const merged = mergeKeyPatches(
      keyPatchForSlot('asr-cloud', 'sk-shared'),
      keyPatchForSlot('llm', 'sk-shared'),
    );
    expect(merged).toEqual({
      asr: { cloud: { apiKey: 'sk-shared' } },
      llm: { apiKey: 'sk-shared' },
    });
  });

  it('keeps both asr sub-slots when merging', () => {
    const merged = mergeKeyPatches(
      keyPatchForSlot('asr-cloud', 'sk-1'),
      keyPatchForSlot('asr-realtime', 'sk-2'),
    );
    expect(merged.asr).toEqual({
      cloud: { apiKey: 'sk-1' },
      realtime: { apiKey: 'sk-2' },
    });
  });
});
