/**
 * Onboarding plans: which catalog presets each wizard plan wires up, and the
 * single settings patch that applies one.
 *
 * Pure data + pure functions (no React, no electron) so the mapping is unit
 * testable and so the wizard never hardcodes a base URL or a model name — every
 * endpoint comes from shared/providerCatalog.ts.
 */
import { findPresetById, type ProviderPreset } from './providerCatalog';
import type { OnboardingPlan, SettingsPatch, UiLang } from './protocol';

/** stable catalog ids the wizard offers (see SPEC §A) */
export const PLAN_PRESET_IDS = {
  asrRealtime: 'aliyun.cn.asr.fun-realtime',
  asrSegment: 'mimo.asr.segment',
  llmDeepseek: 'deepseek.text.fast',
  llmMimo: 'mimo.text.fast',
} as const;

/** which encrypted settings slot a key belongs to */
export type KeySlot = 'asr-realtime' | 'asr-cloud' | 'llm';

export interface PlanSlot {
  slot: KeySlot;
  preset: ProviderPreset;
}

export interface PlanDefinition {
  plan: OnboardingPlan;
  /** speech recognition; absent for the 'advanced' escape hatch */
  asr?: PlanSlot;
  /** text LLM; absent for 'transcription-only' and 'advanced' */
  llm?: PlanSlot;
  backend?: 'cloud' | 'cloud-realtime';
  /** the two slots live on the same provider, so one key can serve both */
  canShareKey: boolean;
}

/**
 * The catalog is static and its ids are asserted by test/providerCatalog.spec.ts,
 * so a miss here means the catalog was edited without updating the wizard —
 * fail loudly at module load rather than rendering an empty card.
 */
function requirePreset(id: string): ProviderPreset {
  const preset = findPresetById(id);
  if (!preset) throw new Error(`onboarding: provider preset '${id}' is missing from the catalog`);
  return preset;
}

export function planDefinition(plan: OnboardingPlan): PlanDefinition {
  switch (plan) {
    case 'recommended':
      return {
        plan,
        asr: { slot: 'asr-realtime', preset: requirePreset(PLAN_PRESET_IDS.asrRealtime) },
        llm: { slot: 'llm', preset: requirePreset(PLAN_PRESET_IDS.llmDeepseek) },
        backend: 'cloud-realtime',
        canShareKey: false,
      };
    case 'mimo-simple':
      return {
        plan,
        asr: { slot: 'asr-cloud', preset: requirePreset(PLAN_PRESET_IDS.asrSegment) },
        llm: { slot: 'llm', preset: requirePreset(PLAN_PRESET_IDS.llmMimo) },
        backend: 'cloud',
        canShareKey: true,
      };
    case 'transcription-only':
      return {
        plan,
        asr: { slot: 'asr-realtime', preset: requirePreset(PLAN_PRESET_IDS.asrRealtime) },
        backend: 'cloud-realtime',
        canShareKey: false,
      };
    case 'advanced':
    default:
      return { plan: 'advanced', canShareKey: false };
  }
}

export interface PlanPatchOptions {
  micEnabled: boolean;
  micDeviceId?: string;
  /** macOS: the input standing in for system audio (BlackHole & co.) */
  themDeviceId?: string;
  lang: UiLang;
}

/**
 * ONE settings patch for the whole wizard result. Every `asr.*` patch rebuilds
 * the ASR engine, so the wizard must never split this into several writes.
 * API keys are NOT part of it — they are saved per card, encrypted main-side.
 */
export function buildPlanPatch(plan: OnboardingPlan, opts: PlanPatchOptions): SettingsPatch {
  const def = planDefinition(plan);
  const patch: SettingsPatch = {
    ui: { lang: opts.lang },
    audio: {
      micEnabled: opts.micEnabled,
      ...(opts.micDeviceId !== undefined ? { micDeviceId: opts.micDeviceId } : {}),
      ...(opts.themDeviceId !== undefined ? { themDeviceId: opts.themDeviceId } : {}),
    },
  };
  if (def.asr && def.backend) {
    const { preset } = def.asr;
    patch.asr = {
      backend: def.backend,
      providerId: preset.providerId,
      ...(def.asr.slot === 'asr-realtime'
        ? { realtime: { baseUrl: preset.baseUrl, model: preset.model } }
        : { cloud: { baseUrl: preset.baseUrl, model: preset.model } }),
    };
  }
  if (def.llm) {
    patch.llm = {
      baseUrl: def.llm.preset.baseUrl,
      model: def.llm.preset.model,
      providerId: def.llm.preset.providerId,
    };
  }
  return patch;
}

/** settings patch that stores one plaintext key into the given slot */
export function keyPatchForSlot(slot: KeySlot, apiKey: string): SettingsPatch {
  switch (slot) {
    case 'llm':
      return { llm: { apiKey } };
    case 'asr-cloud':
      return { asr: { cloud: { apiKey } } };
    case 'asr-realtime':
    default:
      return { asr: { realtime: { apiKey } } };
  }
}

/** merge two key patches so a shared key is written in a SINGLE settings call */
export function mergeKeyPatches(a: SettingsPatch, b: SettingsPatch): SettingsPatch {
  return {
    ...a,
    ...b,
    ...(a.llm || b.llm ? { llm: { ...a.llm, ...b.llm } } : {}),
    ...(a.asr || b.asr
      ? {
          asr: {
            ...a.asr,
            ...b.asr,
            ...(a.asr?.cloud || b.asr?.cloud
              ? { cloud: { ...a.asr?.cloud, ...b.asr?.cloud } }
              : {}),
            ...(a.asr?.realtime || b.asr?.realtime
              ? { realtime: { ...a.asr?.realtime, ...b.asr?.realtime } }
              : {}),
          },
        }
      : {}),
  };
}
