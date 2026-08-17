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
import type {
  OnboardingCompletePayload,
  OnboardingProgressPatch,
  OnboardingState,
  ProviderSlot,
  ProviderVerification,
  PublicSettings,
  SettingsFile,
  SettingsPatch,
  UiLang,
} from '../shared/protocol';
import { defaultHotkeysForPlatform } from '../shared/platform';
import { providerIdForEndpoint } from '../shared/providerCatalog';

export interface SecretCipher {
  available(): boolean;
  /**
   * true only for OS-backed encryption. The plain fallback sets it to false so
   * the store can tell the UI that keys are merely obfuscated on this machine
   * (PublicSettings.weakCrypto).
   */
  readonly secure: boolean;
  /** plaintext -> base64 ciphertext */
  encrypt(plain: string): string;
  /** base64 ciphertext -> plaintext */
  decrypt(b64: string): string;
}

/** Fallback when OS encryption is unavailable: marked base64 (obfuscation only). */
export const plainCipher: SecretCipher = {
  available: () => true,
  secure: false,
  encrypt: (plain) => `plain:${Buffer.from(plain, 'utf8').toString('base64')}`,
  decrypt: (b64) =>
    b64.startsWith('plain:') ? Buffer.from(b64.slice(6), 'base64').toString('utf8') : '',
};

export function defaultSettings(platform: string = process.platform): SettingsFile {
  const hotkeys = defaultHotkeysForPlatform(platform);
  return {
    version: 2,
    // A brand new profile has never seen the wizard; the setup window owns
    // startup until it completes (electron/main.ts gating).
    // MC_DEV_DEFAULT_LOCAL_ASR=1 keeps the pre-wizard developer workflow:
    // the defaults below already select the local Fun-ASR sidecar, so all the
    // flag has to do is let boot go straight to the main window.
    onboarding: {
      schemaVersion: 1,
      completed: process.env.MC_DEV_DEFAULT_LOCAL_ASR === '1',
    },
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
      // opt-in only: a meeting copilot has no business starting itself
      autoLaunch: false,
      trayNoticeShown: false,
    },
    audio: {
      micEnabled: false,
    },
  };
}

/** last <=4 characters of a key — the only fragment ever shown to the user. */
export function apiKeyHint(plain: string): string | undefined {
  const key = plain.trim();
  return key ? key.slice(-4) : undefined;
}

/**
 * Per-section spread merge against the defaults. Unknown keys in the stored
 * file survive (forward compatibility); missing ones get the default.
 */
function mergeWithDefaults(raw: Partial<SettingsFile>, defaults: SettingsFile): SettingsFile {
  return {
    version: 2,
    onboarding: { ...defaults.onboarding, ...raw.onboarding, schemaVersion: 1 },
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
}

/**
 * v1 -> v2 settings migration. Pure: no fs, no electron, no cipher — so it is
 * unit-testable and can never damage the file it is reading from.
 *
 * Guarantees:
 *  - `apiKeyEnc` ciphertexts are carried over byte-for-byte (we cannot decrypt
 *    here, and re-encrypting would need safeStorage);
 *  - baseUrl / model / proxy / backend / ui / audio are untouched;
 *  - `providerId` is inferred from the catalog by exact baseUrl+model match,
 *    falling back to 'custom';
 *  - a settings file EXISTS, so this user already configured the app by hand:
 *    onboarding is marked completed (grandfathered) and the wizard never
 *    hijacks their next launch.
 *
 * `apiKeyHint` is deliberately NOT back-filled: the plaintext is unavailable
 * during migration. Hints appear the next time a key is saved.
 *
 * Throws on input that is not a JSON object; the caller keeps the original
 * file untouched and boots with defaults.
 */
export function migrateSettingsV1ToV2(
  v1: unknown,
  platform: string = process.platform,
): SettingsFile {
  if (!v1 || typeof v1 !== 'object' || Array.isArray(v1)) {
    throw new Error('settings: v1 payload is not a JSON object');
  }
  const raw = v1 as Partial<SettingsFile>;
  const next = mergeWithDefaults(raw, defaultSettings(platform));

  // existing users are grandfathered past the wizard; keep any progress fields
  // a re-run may already have written. `migratedFromV1` is what lets the main
  // window tell a hand-configured profile from one the wizard produced, so the
  // upgrade notice only reaches the former.
  next.onboarding = {
    ...next.onboarding,
    schemaVersion: 1,
    completed: true,
    migratedFromV1: true,
  };

  next.llm.providerId = providerIdForEndpoint(next.llm.baseUrl, next.llm.model, 'text-llm');
  if (next.vision.baseUrl && next.vision.model) {
    next.vision.providerId = providerIdForEndpoint(
      next.vision.baseUrl,
      next.vision.model,
      'vision',
    );
  }

  const rt = next.asr.realtime;
  const cl = next.asr.cloud;
  const rtProvider =
    rt?.baseUrl && rt?.model
      ? providerIdForEndpoint(rt.baseUrl, rt.model, 'asr-realtime')
      : undefined;
  const clProvider =
    cl?.baseUrl && cl?.model ? providerIdForEndpoint(cl.baseUrl, cl.model, 'asr-segment') : undefined;
  // the active backend decides which slot names the provider; local backends
  // have no cloud provider at all, so the field stays absent
  const asrProvider = next.asr.backend === 'cloud' ? clProvider ?? rtProvider : rtProvider ?? clProvider;
  if (asrProvider) next.asr.providerId = asrProvider;

  return next;
}

export class SettingsStore {
  data: SettingsFile;
  /** true when this boot upgraded a v1 file (main logs it once) */
  readonly migratedFromV1: boolean = false;
  /** raw v1 text kept until the first v2 save writes settings.json.bak */
  private pendingBackup: string | null = null;

  constructor(
    private readonly filePath: string,
    private readonly cipher: SecretCipher,
    /** UI language when the user never chose one (derived from OS locale) */
    private readonly fallbackUiLang: UiLang = 'zh',
  ) {
    const loaded = this.loadFromDisk();
    this.data = loaded.data;
    this.migratedFromV1 = loaded.migrated;
    if (loaded.migrated) {
      // persist eagerly so the .bak escape hatch exists immediately; a failure
      // here (read-only dir) must never take the app down
      try {
        this.save();
      } catch (e) {
        console.warn('[settings] could not persist the v2 migration:', (e as Error).message);
      }
    }
  }

  private loadFromDisk(): { data: SettingsFile; migrated: boolean } {
    const defaults = defaultSettings();
    if (!existsSync(this.filePath)) return { data: defaults, migrated: false };

    let text: string;
    let raw: unknown;
    try {
      text = readFileSync(this.filePath, 'utf8');
      raw = JSON.parse(text);
    } catch (e) {
      // corrupt or unreadable: boot with defaults and leave the file ALONE
      console.warn('[settings] failed to load, using defaults:', (e as Error).message);
      return { data: defaults, migrated: false };
    }

    const version = (raw as { version?: unknown } | null)?.version;
    if (version === 2) {
      return { data: mergeWithDefaults(raw as Partial<SettingsFile>, defaults), migrated: false };
    }

    // anything older (v1, or a file written before `version` existed)
    try {
      const data = migrateSettingsV1ToV2(raw);
      this.pendingBackup = text;
      console.log(`[settings] migrated settings.json v${String(version ?? 1)} -> v2`);
      return { data, migrated: true };
    } catch (e) {
      console.warn('[settings] migration failed, using defaults:', (e as Error).message);
      return { data: defaults, migrated: false };
    }
  }

  save(): void {
    const dir = dirname(this.filePath);
    mkdirSync(dir, { recursive: true });
    if (this.pendingBackup !== null) {
      const bak = `${this.filePath}.bak`;
      const original = this.pendingBackup;
      this.pendingBackup = null; // one attempt; never loop on a failing disk
      try {
        // an existing .bak is an older original — do not overwrite it
        if (!existsSync(bak)) writeFileSync(bak, original, 'utf8');
      } catch (e) {
        console.warn('[settings] could not write settings.json.bak:', (e as Error).message);
      }
    }
    const tmp = `${this.filePath}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
    renameSync(tmp, this.filePath);
  }

  // ---- onboarding ----

  getOnboarding(): OnboardingState {
    return { ...this.data.onboarding };
  }

  /** 保存并稍后继续 / dismissing the upgrade notice — never flips `completed` */
  saveOnboardingProgress(patch: OnboardingProgressPatch): OnboardingState {
    this.data.onboarding = {
      ...this.data.onboarding,
      ...stripUndefined(patch),
      schemaVersion: 1,
    };
    this.save();
    return this.getOnboarding();
  }

  /** the wizard finished; the main window may take over */
  completeOnboarding(payload: OnboardingCompletePayload = {}): OnboardingState {
    this.data.onboarding = {
      ...this.data.onboarding,
      ...stripUndefined(payload),
      schemaVersion: 1,
      completed: true,
      completedAt: new Date().toISOString(),
    };
    this.save();
    return this.getOnboarding();
  }

  applyPatch(patch: SettingsPatch): void {
    if (patch.llm) {
      const { apiKey, ...rest } = patch.llm;
      Object.assign(this.data.llm, stripUndefined(rest));
      if (apiKey !== undefined) {
        this.writeKey(this.data.llm, apiKey, rest.verification !== undefined);
      }
    }
    if (patch.vision) {
      const { apiKey, ...rest } = patch.vision;
      Object.assign(this.data.vision, stripUndefined(rest));
      if (apiKey !== undefined) {
        this.writeKey(this.data.vision, apiKey, rest.verification !== undefined);
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
          this.writeKey(this.data.asr.cloud, apiKey, crest.verification !== undefined);
        }
      }
      if (realtime) {
        const { apiKey, ...rrest } = realtime;
        this.data.asr.realtime = { ...this.data.asr.realtime, ...stripUndefined(rrest) };
        if (apiKey !== undefined) {
          this.writeKey(this.data.asr.realtime, apiKey, rrest.verification !== undefined);
        }
      }
    }
    if (patch.ui) Object.assign(this.data.ui, stripUndefined(patch.ui));
    if (patch.audio) Object.assign(this.data.audio, stripUndefined(patch.audio));
    this.save();
  }

  /**
   * Persist the outcome of a connection test into one provider slot.
   *
   * Deliberately NOT routed through {@link applyPatch}: the `settings:set`
   * handler restarts the ASR engine whenever `asr.cloud` / `asr.realtime` is
   * present in a patch, so recording "the realtime key tested OK" that way
   * would bounce a live transcription session every time the user pressed
   * 重新测试. This writes the one field and saves, nothing else.
   */
  recordVerification(slot: ProviderSlot, verification: ProviderVerification): void {
    const value: ProviderVerification = { ...verification };
    switch (slot) {
      case 'llm':
        this.data.llm.verification = value;
        break;
      case 'vision':
        this.data.vision.verification = value;
        break;
      case 'asr-cloud':
        this.data.asr.cloud = { ...this.data.asr.cloud, verification: value };
        break;
      case 'asr-realtime':
        this.data.asr.realtime = { ...this.data.asr.realtime, verification: value };
        break;
    }
    this.save();
  }

  /**
   * Encrypt a plaintext key into a slot and derive its display hint main-side.
   * '' clears the slot. A key change invalidates the stored verification
   * unless the very same patch supplied a fresh one.
   */
  private writeKey(
    slot: { apiKeyEnc?: string; apiKeyHint?: string; verification?: ProviderVerification },
    apiKey: string,
    keepVerification: boolean,
  ): void {
    if (apiKey === '') {
      slot.apiKeyEnc = undefined;
      slot.apiKeyHint = undefined;
    } else {
      slot.apiKeyEnc = this.cipher.encrypt(apiKey);
      slot.apiKeyHint = apiKeyHint(apiKey);
    }
    if (!keepVerification) slot.verification = undefined;
  }

  getPublic(): PublicSettings {
    const d = this.data;
    return {
      version: 2,
      // the renderer must be able to warn before it hands over a plaintext key
      weakCrypto: !this.cipher.secure,
      onboarding: { ...d.onboarding },
      llm: {
        baseUrl: d.llm.baseUrl,
        model: d.llm.model,
        answerLang: d.llm.answerLang,
        answerWithVision: !!d.llm.answerWithVision,
        apiKeySet: !!d.llm.apiKeyEnc,
        providerId: d.llm.providerId,
        apiKeyHint: d.llm.apiKeyHint,
        verification: d.llm.verification,
      },
      vision: {
        baseUrl: d.vision.baseUrl,
        model: d.vision.model,
        proxyUrl: d.vision.proxyUrl,
        apiKeySet: !!d.vision.apiKeyEnc,
        providerId: d.vision.providerId,
        apiKeyHint: d.vision.apiKeyHint,
        verification: d.vision.verification,
      },
      asr: {
        language: d.asr.language,
        modelsDir: d.asr.modelsDir,
        backend: d.asr.backend ?? 'local',
        providerId: d.asr.providerId,
        cloud: {
          baseUrl: d.asr.cloud?.baseUrl,
          model: d.asr.cloud?.model,
          apiKeySet: !!d.asr.cloud?.apiKeyEnc,
          apiKeyHint: d.asr.cloud?.apiKeyHint,
          verification: d.asr.cloud?.verification,
        },
        realtime: {
          baseUrl: d.asr.realtime?.baseUrl,
          model: d.asr.realtime?.model,
          apiKeySet: !!d.asr.realtime?.apiKeyEnc,
          apiKeyHint: d.asr.realtime?.apiKeyHint,
          verification: d.asr.realtime?.verification,
        },
        localRealtime: { model: d.asr.localRealtime?.model },
      },
      // knowledge lives in a separate file; main fills the real char count
      knowledge: { chars: 0 },
      ui: {
        ...d.ui,
        lang: d.ui.lang ?? this.fallbackUiLang,
        // both are optional on disk (files written before Phase 4 lack them)
        // but always booleans on the wire, so the UI needs no ?? dance
        autoLaunch: !!d.ui.autoLaunch,
        trayNoticeShown: !!d.ui.trayNoticeShown,
      },
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

  /** the stored key behind one slot — used by 「用已保存的 Key 重新测试」 */
  getApiKeyForSlot(slot: ProviderSlot): string | undefined {
    switch (slot) {
      case 'llm':
        return this.getLlmApiKey();
      case 'vision':
        return this.getVisionApiKey();
      case 'asr-cloud':
        return this.getCloudAsrApiKey();
      case 'asr-realtime':
        return this.getRealtimeAsrApiKey();
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
