import { describe, expect, it } from 'vitest';
import {
  asrSlotForBackend,
  chipTone,
  deriveServiceHealth,
  type HealthInput,
} from '../shared/healthState';
import type { ProviderVerification, PublicSettings } from '../shared/protocol';

const okVerdict: ProviderVerification = {
  lastTestAt: '2026-08-17T06:00:00.000Z',
  lastTestOk: true,
  lastTestCode: 'OK',
  latencyMs: 420,
};
const badVerdict: ProviderVerification = {
  lastTestAt: '2026-08-17T06:00:00.000Z',
  lastTestOk: false,
  lastTestCode: 'INVALID_KEY',
  latencyMs: 200,
};

function settings(over: Partial<PublicSettings> = {}): PublicSettings {
  return {
    version: 2,
    weakCrypto: false,
    onboarding: { schemaVersion: 1, completed: true },
    llm: {
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
      answerLang: 'chinese',
      answerWithVision: false,
      apiKeySet: true,
    },
    vision: { apiKeySet: false },
    knowledge: { chars: 0 },
    asr: {
      language: 'auto',
      backend: 'cloud-realtime',
      cloud: { apiKeySet: false },
      realtime: {
        baseUrl: 'wss://dashscope.aliyuncs.com/api-ws/v1/inference',
        model: 'fun-asr-realtime',
        apiKeySet: true,
      },
      localRealtime: { model: 'fun-asr-nano' },
    },
    ui: {
      stealth: true,
      hotkeyToggle: 'Control+Shift+M',
      hotkeyShot: 'Control+Shift+S',
      opacity: 0.94,
      fontScale: 'medium',
      theme: 'dark',
      lang: 'zh',
      autoLaunch: false,
      trayNoticeShown: false,
    },
    audio: { micEnabled: false },
    ...over,
  };
}

const input = (over: Partial<HealthInput> = {}): HealthInput => ({
  settings: settings(),
  asr: { phase: 'ready' },
  capturing: false,
  ...over,
});

describe('asrSlotForBackend', () => {
  it('maps cloud backends to their own slots and local ones to none', () => {
    expect(asrSlotForBackend('cloud')).toBe('asr-cloud');
    expect(asrSlotForBackend('cloud-realtime')).toBe('asr-realtime');
    expect(asrSlotForBackend('local')).toBeUndefined();
    expect(asrSlotForBackend('local-realtime')).toBeUndefined();
  });
});

describe('deriveServiceHealth — ASR', () => {
  it('is untested when the key is stored but no test ever passed', () => {
    expect(deriveServiceHealth(input()).asr.state).toBe('untested');
  });

  it('is ok once a test passed', () => {
    const s = settings();
    s.asr.realtime.verification = okVerdict;
    expect(deriveServiceHealth(input({ settings: s })).asr.state).toBe('ok');
  });

  it('is failed when the last test failed, even though the engine reports ready', () => {
    const s = settings();
    s.asr.realtime.verification = badVerdict;
    const h = deriveServiceHealth(input({ settings: s })).asr;
    expect(h.state).toBe('failed');
    expect(h.verification?.lastTestCode).toBe('INVALID_KEY');
  });

  it('lets a live fatal engine error outrank a passing stored verdict', () => {
    const s = settings();
    s.asr.realtime.verification = okVerdict;
    const h = deriveServiceHealth(
      input({ settings: s, asr: { phase: 'error', lastError: 'sidecar died' } }),
    ).asr;
    expect(h.state).toBe('failed');
    expect(h.detail).toBe('sidecar died');
  });

  it('is unconfigured when the cloud backend has no key', () => {
    const s = settings();
    s.asr.realtime.apiKeySet = false;
    expect(deriveServiceHealth(input({ settings: s })).asr.state).toBe('unconfigured');
    expect(deriveServiceHealth(input({ settings: s })).transcriptionAvailable).toBe(false);
  });

  it('never asks a local backend for a key', () => {
    const s = settings();
    s.asr.backend = 'local-realtime';
    s.asr.realtime.apiKeySet = false;
    const h = deriveServiceHealth(input({ settings: s })).asr;
    expect(h.state).toBe('ok');
    expect(h.local).toBe(true);
    expect(h.slot).toBeUndefined();
  });

  it('reports connecting while the engine loads', () => {
    expect(deriveServiceHealth(input({ asr: { phase: 'loading' } })).asr.state).toBe('connecting');
  });

  it('reads the cloud slot when the backend is per-segment', () => {
    const s = settings();
    s.asr.backend = 'cloud';
    s.asr.cloud = { baseUrl: 'https://api.xiaomimimo.com/v1', model: 'mimo-v2.5-asr', apiKeySet: true, verification: okVerdict };
    const h = deriveServiceHealth(input({ settings: s })).asr;
    expect(h.slot).toBe('asr-cloud');
    expect(h.state).toBe('ok');
  });
});

describe('deriveServiceHealth — LLM, audio, vision', () => {
  it('marks the LLM unconfigured without a key and disables answers', () => {
    const s = settings();
    s.llm.apiKeySet = false;
    const r = deriveServiceHealth(input({ settings: s }));
    expect(r.llm.state).toBe('unconfigured');
    expect(r.answersAvailable).toBe(false);
    // ASR still works: partial availability is normal, not a breakage
    expect(r.transcriptionAvailable).toBe(true);
    expect(r.needsSetup).toBe(false);
  });

  it('marks the LLM failed after a failed test', () => {
    const s = settings();
    s.llm.verification = badVerdict;
    expect(deriveServiceHealth(input({ settings: s })).llm.state).toBe('failed');
  });

  it('still allows answers when the last LLM test failed (the key may be fine now)', () => {
    const s = settings();
    s.llm.verification = badVerdict;
    expect(deriveServiceHealth(input({ settings: s })).answersAvailable).toBe(true);
  });

  it('tracks audio capture', () => {
    expect(deriveServiceHealth(input()).audio.state).toBe('idle');
    expect(deriveServiceHealth(input({ capturing: true })).audio.state).toBe('ok');
  });

  it('treats vision as optional and off until fully configured', () => {
    const off = deriveServiceHealth(input()).vision;
    expect(off.state).toBe('off');
    expect(off.optional).toBe(true);

    const s = settings();
    s.vision = {
      baseUrl: 'https://api.xiaomimimo.com/v1',
      model: 'mimo-v2.5',
      apiKeySet: true,
      verification: okVerdict,
    };
    expect(deriveServiceHealth(input({ settings: s })).vision.state).toBe('ok');
  });

  it('asks for the wizard only when NOTHING is configured', () => {
    const s = settings();
    s.llm.apiKeySet = false;
    s.asr.realtime.apiKeySet = false;
    const r = deriveServiceHealth(input({ settings: s }));
    expect(r.needsSetup).toBe(true);
  });
});

describe('chipTone', () => {
  it('does not cry wolf about an untested-but-configured service', () => {
    expect(chipTone({ key: 'asr', state: 'untested' })).toBe('ok');
    expect(chipTone({ key: 'asr', state: 'ok' })).toBe('ok');
  });

  it('separates busy, broken and absent', () => {
    expect(chipTone({ key: 'asr', state: 'connecting' })).toBe('busy');
    expect(chipTone({ key: 'asr', state: 'failed' })).toBe('bad');
    expect(chipTone({ key: 'llm', state: 'unconfigured' })).toBe('none');
    expect(chipTone({ key: 'audio', state: 'idle' })).toBe('none');
    expect(chipTone({ key: 'vision', state: 'off' })).toBe('none');
  });
});
