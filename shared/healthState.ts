/**
 * Service health derivation (Phase 3b, spec §E.4).
 *
 * "Is this app actually working right now" is answered from four independent
 * facts the renderer already has — the ASR engine's own events, the capture
 * flag, which keys are configured, and the last connection-test verdict the
 * main process recorded per slot. Putting the rules here (pure, no React, no
 * electron) keeps the status chips, the health panel and the answer-button
 * gating from drifting into three slightly different opinions.
 *
 * Two product rules are encoded rather than left to the UI:
 *  - PARTIAL availability is normal, not an error. ASR without an LLM still
 *    transcribes; an LLM without ASR still answers typed questions and
 *    screenshots. Only "neither is configured" is a call to action.
 *  - a cloud slot that has never been tested is USABLE, not broken. It reads
 *    'untested' so the panel can say so, but it never shows as a failure.
 */
import type { ProviderSlot, ProviderVerification, PublicSettings } from './protocol';

export type ServiceKey = 'asr' | 'llm' | 'audio' | 'vision';

export type ServiceState =
  /** configured and (as far as we know) working */
  | 'ok'
  /** the engine is still coming up */
  | 'connecting'
  /** configured, but no connection test has ever passed */
  | 'untested'
  /** no key / no endpoint */
  | 'unconfigured'
  /** the engine reported a fatal error, or the last test failed */
  | 'failed'
  /** available but not running right now (audio capture) */
  | 'idle'
  /** optional feature the user has not turned on */
  | 'off';

export interface ServiceHealth {
  key: ServiceKey;
  state: ServiceState;
  /** credential slot behind this service, when it has one */
  slot?: ProviderSlot;
  verification?: ProviderVerification;
  /** engine-level error text (ASR only) — already user-facing */
  detail?: string;
  /** a bad state here must never read as the app being broken */
  optional?: boolean;
  /** the backend needs no cloud credentials at all (local ASR) */
  local?: boolean;
}

export interface HealthInput {
  settings: PublicSettings;
  asr: { phase: 'loading' | 'ready' | 'error'; lastError?: string };
  capturing: boolean;
}

export interface ServiceHealthReport {
  asr: ServiceHealth;
  llm: ServiceHealth;
  audio: ServiceHealth;
  vision: ServiceHealth;
  /** the AI can be asked something right now */
  answersAvailable: boolean;
  /** speech recognition has somewhere to go */
  transcriptionAvailable: boolean;
  /** neither half is configured — the wizard is the honest answer */
  needsSetup: boolean;
}

/** which stored credential slot an ASR backend uses; local backends use none */
export function asrSlotForBackend(backend: PublicSettings['asr']['backend']): ProviderSlot | undefined {
  if (backend === 'cloud') return 'asr-cloud';
  if (backend === 'cloud-realtime') return 'asr-realtime';
  return undefined;
}

function deriveAsr(input: HealthInput): ServiceHealth {
  const { settings, asr } = input;
  const slot = asrSlotForBackend(settings.asr.backend);
  const base: ServiceHealth = { key: 'asr', state: 'ok', slot, local: slot === undefined };

  if (slot) {
    const cfg = slot === 'asr-cloud' ? settings.asr.cloud : settings.asr.realtime;
    base.verification = cfg.verification;
    if (!cfg.apiKeySet || !cfg.baseUrl || !cfg.model) return { ...base, state: 'unconfigured' };
  }
  // a fatal engine error outranks any stored verdict: it is happening NOW
  if (asr.phase === 'error') return { ...base, state: 'failed', detail: asr.lastError };
  // a failed test outranks "the engine came up": cloud engines report ready
  // before the first byte of audio, so readiness proves nothing about auth
  if (base.verification?.lastTestOk === false) return { ...base, state: 'failed' };
  if (asr.phase === 'loading') return { ...base, state: 'connecting' };
  if (!slot || base.verification?.lastTestOk === true) return { ...base, state: 'ok' };
  return { ...base, state: 'untested' };
}

function deriveLlm(settings: PublicSettings): ServiceHealth {
  const base: ServiceHealth = {
    key: 'llm',
    state: 'ok',
    slot: 'llm',
    verification: settings.llm.verification,
  };
  if (!settings.llm.apiKeySet || !settings.llm.baseUrl || !settings.llm.model) {
    return { ...base, state: 'unconfigured' };
  }
  if (base.verification?.lastTestOk === false) return { ...base, state: 'failed' };
  if (base.verification?.lastTestOk === true) return { ...base, state: 'ok' };
  return { ...base, state: 'untested' };
}

function deriveAudio(capturing: boolean): ServiceHealth {
  return { key: 'audio', state: capturing ? 'ok' : 'idle' };
}

function deriveVision(settings: PublicSettings): ServiceHealth {
  const base: ServiceHealth = {
    key: 'vision',
    state: 'off',
    slot: 'vision',
    optional: true,
    verification: settings.vision.verification,
  };
  if (!settings.vision.baseUrl || !settings.vision.model || !settings.vision.apiKeySet) return base;
  if (base.verification?.lastTestOk === false) return { ...base, state: 'failed' };
  if (base.verification?.lastTestOk === true) return { ...base, state: 'ok' };
  return { ...base, state: 'untested' };
}

export function deriveServiceHealth(input: HealthInput): ServiceHealthReport {
  const asr = deriveAsr(input);
  const llm = deriveLlm(input.settings);
  const audio = deriveAudio(input.capturing);
  const vision = deriveVision(input.settings);
  const answersAvailable = llm.state !== 'unconfigured';
  const transcriptionAvailable = asr.state !== 'unconfigured';
  return {
    asr,
    llm,
    audio,
    vision,
    answersAvailable,
    transcriptionAvailable,
    needsSetup: !answersAvailable && !transcriptionAvailable,
  };
}

/** how a state renders in the compact status-bar chips */
export type ChipTone = 'ok' | 'busy' | 'bad' | 'none';

export function chipTone(health: ServiceHealth): ChipTone {
  switch (health.state) {
    case 'ok':
    // never tested is not the same as broken — the panel explains, the chip
    // does not cry wolf
    case 'untested':
      return 'ok';
    case 'connecting':
      return 'busy';
    case 'failed':
      return 'bad';
    default:
      return 'none';
  }
}
