/**
 * Settings store: plain JSON file + OS-encrypted secrets (safeStorage).
 * HARD RULE (PLAN §3.2, Natively lesson): no Chromium DOM storage / LevelDB
 * for anything that matters. Load failures fall back to defaults — the app
 * must always boot.
 *
 * Dependencies are injected (file path + cipher) so this is unit-testable
 * without Electron.
 */
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';
import type { PublicSettings, SettingsFile, SettingsPatch } from '../shared/protocol';
import { defaultHotkeysForPlatform } from '../shared/platform';

export interface SecretCipher {
  available(): boolean;
  /** plaintext -> base64 ciphertext */
  encrypt(plain: string): string;
  /** base64 ciphertext -> plaintext */
  decrypt(b64: string): string;
}

/** Fallback when OS encryption is unavailable: marked base64 (obfuscation only). */
export const plainCipher: SecretCipher = {
  available: () => true,
  encrypt: (plain) => `plain:${Buffer.from(plain, 'utf8').toString('base64')}`,
  decrypt: (b64) =>
    b64.startsWith('plain:') ? Buffer.from(b64.slice(6), 'base64').toString('utf8') : '',
};

export function defaultSettings(platform: string = process.platform): SettingsFile {
  const hotkeys = defaultHotkeysForPlatform(platform);
  return {
    version: 1,
    llm: {
      baseUrl: 'https://api.deepseek.com/v1',
      // 'deepseek-chat' = v4-flash in NON-thinking mode (first token ~0.4 s).
      // Plain 'deepseek-v4-flash' streams a long reasoning_content chain first
      // — too slow for a live copilot (measured 2026-07-09).
      model: 'deepseek-chat',
      answerLang: 'chinese',
      answerWithVision: false,
    },
    vision: {},
    asr: {
      language: 'auto',
      // default = local Fun-ASR-Nano via the auto-spawned sidecar: free,
      // private, zh+en good with punctuation (user decision 2026-07-10)
      backend: 'local-realtime',
      cloud: {},
      realtime: {},
      localRealtime: { model: 'fun-asr-nano' },
    },
    ui: {
      stealth: true,
      hotkeyToggle: hotkeys.toggle,
      hotkeyShot: hotkeys.shot,
      opacity: 0.94,
      // medium = 16px answer body (was 13px) — readable at a glance mid-interview
      fontScale: 'medium',
      theme: 'dark',
    },
    audio: {
      micEnabled: false,
    },
  };
}

export class SettingsStore {
  data: SettingsFile;

  constructor(
    private readonly filePath: string,
    private readonly cipher: SecretCipher,
  ) {
    this.data = this.loadFromDisk();
  }

  private loadFromDisk(): SettingsFile {
    const defaults = defaultSettings();
    try {
      if (!existsSync(this.filePath)) return defaults;
      const raw = JSON.parse(readFileSync(this.filePath, 'utf8')) as Partial<SettingsFile>;
      // per-section merge keeps forward/backward compatibility
      return {
        version: 1,
        llm: { ...defaults.llm, ...raw.llm },
        vision: { ...defaults.vision, ...raw.vision },
        asr: {
          ...defaults.asr,
          ...raw.asr,
          cloud: { ...defaults.asr.cloud, ...raw.asr?.cloud },
          realtime: { ...defaults.asr.realtime, ...raw.asr?.realtime },
          localRealtime: { ...defaults.asr.localRealtime, ...raw.asr?.localRealtime },
        },
        ui: { ...defaults.ui, ...raw.ui },
        audio: { ...defaults.audio, ...raw.audio },
      };
    } catch (e) {
      console.warn('[settings] failed to load, using defaults:', (e as Error).message);
      return defaults;
    }
  }

  save(): void {
    const dir = dirname(this.filePath);
    mkdirSync(dir, { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
    renameSync(tmp, this.filePath);
  }

  applyPatch(patch: SettingsPatch): void {
    if (patch.llm) {
      const { apiKey, ...rest } = patch.llm;
      Object.assign(this.data.llm, stripUndefined(rest));
      if (apiKey !== undefined) {
        this.data.llm.apiKeyEnc = apiKey === '' ? undefined : this.cipher.encrypt(apiKey);
      }
    }
    if (patch.vision) {
      const { apiKey, ...rest } = patch.vision;
      Object.assign(this.data.vision, stripUndefined(rest));
      if (apiKey !== undefined) {
        this.data.vision.apiKeyEnc = apiKey === '' ? undefined : this.cipher.encrypt(apiKey);
      }
    }
    if (patch.asr) {
      const { cloud, realtime, localRealtime, ...rest } = patch.asr;
      Object.assign(this.data.asr, stripUndefined(rest));
      if (localRealtime) {
        this.data.asr.localRealtime = {
          ...this.data.asr.localRealtime,
          ...stripUndefined(localRealtime),
        };
      }
      if (cloud) {
        const { apiKey, ...crest } = cloud;
        this.data.asr.cloud = { ...this.data.asr.cloud, ...stripUndefined(crest) };
        if (apiKey !== undefined) {
          this.data.asr.cloud.apiKeyEnc = apiKey === '' ? undefined : this.cipher.encrypt(apiKey);
        }
      }
      if (realtime) {
        const { apiKey, ...rrest } = realtime;
        this.data.asr.realtime = { ...this.data.asr.realtime, ...stripUndefined(rrest) };
        if (apiKey !== undefined) {
          this.data.asr.realtime.apiKeyEnc = apiKey === '' ? undefined : this.cipher.encrypt(apiKey);
        }
      }
    }
    if (patch.ui) Object.assign(this.data.ui, stripUndefined(patch.ui));
    if (patch.audio) Object.assign(this.data.audio, stripUndefined(patch.audio));
    this.save();
  }

  getPublic(): PublicSettings {
    const d = this.data;
    return {
      version: 1,
      llm: {
        baseUrl: d.llm.baseUrl,
        model: d.llm.model,
        answerLang: d.llm.answerLang,
        answerWithVision: !!d.llm.answerWithVision,
        apiKeySet: !!d.llm.apiKeyEnc,
      },
      vision: {
        baseUrl: d.vision.baseUrl,
        model: d.vision.model,
        proxyUrl: d.vision.proxyUrl,
        apiKeySet: !!d.vision.apiKeyEnc,
      },
      asr: {
        language: d.asr.language,
        modelsDir: d.asr.modelsDir,
        backend: d.asr.backend ?? 'local',
        cloud: {
          baseUrl: d.asr.cloud?.baseUrl,
          model: d.asr.cloud?.model,
          apiKeySet: !!d.asr.cloud?.apiKeyEnc,
        },
        realtime: {
          baseUrl: d.asr.realtime?.baseUrl,
          model: d.asr.realtime?.model,
          apiKeySet: !!d.asr.realtime?.apiKeyEnc,
        },
        localRealtime: { model: d.asr.localRealtime?.model },
      },
      // knowledge lives in a separate file; main fills the real char count
      knowledge: { chars: 0 },
      ui: { ...d.ui },
      audio: {
        themDeviceId: d.audio.themDeviceId,
        micEnabled: d.audio.micEnabled,
        micDeviceId: d.audio.micDeviceId,
      },
    };
  }

  getLlmApiKey(): string | undefined {
    if (!this.data.llm.apiKeyEnc) return undefined;
    try {
      return this.cipher.decrypt(this.data.llm.apiKeyEnc);
    } catch {
      return undefined;
    }
  }

  getVisionApiKey(): string | undefined {
    if (!this.data.vision.apiKeyEnc) return undefined;
    try {
      return this.cipher.decrypt(this.data.vision.apiKeyEnc);
    } catch {
      return undefined;
    }
  }

  getCloudAsrApiKey(): string | undefined {
    const enc = this.data.asr.cloud?.apiKeyEnc;
    if (!enc) return undefined;
    try {
      return this.cipher.decrypt(enc);
    } catch {
      return undefined;
    }
  }

  getRealtimeAsrApiKey(): string | undefined {
    const enc = this.data.asr.realtime?.apiKeyEnc;
    if (!enc) return undefined;
    try {
      return this.cipher.decrypt(enc);
    } catch {
      return undefined;
    }
  }
}

function stripUndefined<T extends object>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}
