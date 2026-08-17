import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  SettingsStore,
  apiKeyHint,
  defaultSettings,
  migrateSettingsV1ToV2,
  type SecretCipher,
} from '../electron/settings';
import type { SettingsFile } from '../shared/protocol';

const fakeCipher: SecretCipher = {
  available: () => true,
  encrypt: (plain) => `enc:${Buffer.from(plain, 'utf8').toString('base64')}`,
  decrypt: (s) => (s.startsWith('enc:') ? Buffer.from(s.slice(4), 'base64').toString('utf8') : ''),
};

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mc-settings-'));
  file = join(dir, 'settings.json');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('SettingsStore', () => {
  it('boots with defaults when no file exists', () => {
    const s = new SettingsStore(file, fakeCipher);
    expect(s.data).toEqual(defaultSettings());
    expect(s.data.llm.model).toBe('deepseek-chat');
    expect(s.data.llm.answerLang).toBe('chinese');
    expect(s.data.ui.stealth).toBe(true);
    // v2: a brand new profile has never seen the wizard
    expect(s.data.version).toBe(2);
    expect(s.data.onboarding).toEqual({ schemaVersion: 1, completed: false });
    expect(s.migratedFromV1).toBe(false);
    // nothing was written; the wizard decides what the first file looks like
    expect(existsSync(file)).toBe(false);
  });

  it('boots with defaults on corrupt file (never crash boot)', () => {
    writeFileSync(file, '{"llm": {broken json', 'utf8');
    const s = new SettingsStore(file, fakeCipher);
    expect(s.data).toEqual(defaultSettings());
  });

  it('round-trips a patch to disk', () => {
    const s1 = new SettingsStore(file, fakeCipher);
    s1.applyPatch({ asr: { language: 'chinese' }, ui: { hotkeyToggle: 'Alt+X' } });

    const s2 = new SettingsStore(file, fakeCipher);
    expect(s2.data.asr.language).toBe('chinese');
    expect(s2.data.ui.hotkeyToggle).toBe('Alt+X');
    // untouched sections keep defaults
    expect(s2.data.llm.baseUrl).toBe('https://api.deepseek.com/v1');
  });

  it('encrypts the api key at rest and never leaks it via getPublic', () => {
    const s = new SettingsStore(file, fakeCipher);
    s.applyPatch({ llm: { apiKey: 'sk-secret-123' } });

    expect(s.data.llm.apiKeyEnc).toBe(fakeCipher.encrypt('sk-secret-123'));
    expect(s.getLlmApiKey()).toBe('sk-secret-123');

    const pub = JSON.stringify(s.getPublic());
    expect(pub).not.toContain('sk-secret-123');
    expect(s.getPublic().llm.apiKeySet).toBe(true);

    const onDisk = readFileSync(file, 'utf8');
    expect(onDisk).not.toContain('sk-secret-123');
  });

  it('stores the vision key independently of the llm key', () => {
    const s = new SettingsStore(file, fakeCipher);
    s.applyPatch({ vision: { baseUrl: 'https://x/v1', model: 'qwen-vl-max', apiKey: 'sk-vision' } });
    expect(s.getVisionApiKey()).toBe('sk-vision');
    expect(s.getLlmApiKey()).toBeUndefined();
    expect(s.getPublic().vision.apiKeySet).toBe(true);
    expect(JSON.stringify(s.getPublic())).not.toContain('sk-vision');
  });

  it('defaults answerWithVision to false and exposes it publicly', () => {
    const s = new SettingsStore(file, fakeCipher);
    expect(s.getPublic().llm.answerWithVision).toBe(false);
    s.applyPatch({ llm: { answerWithVision: true } });
    expect(s.data.llm.answerWithVision).toBe(true);
    expect(s.getPublic().llm.answerWithVision).toBe(true);
  });

  it('answerWithVision patch does not clobber the api key', () => {
    const s = new SettingsStore(file, fakeCipher);
    s.applyPatch({ llm: { apiKey: 'sk-keep' } });
    s.applyPatch({ llm: { answerWithVision: true } });
    expect(s.getLlmApiKey()).toBe('sk-keep');
    expect(s.data.llm.answerWithVision).toBe(true);
  });

  it('defaults asr backend to local streaming Fun-ASR-Nano', () => {
    const s = new SettingsStore(file, fakeCipher);
    expect(s.data.asr.backend).toBe('local-realtime');
    expect(s.getPublic().asr.backend).toBe('local-realtime');
    expect(s.getPublic().asr.localRealtime.model).toBe('fun-asr-nano');
    expect(s.getPublic().asr.realtime.apiKeySet).toBe(false);
    expect(s.getPublic().asr.cloud.apiKeySet).toBe(false);
  });

  it('keeps the localRealtime defaults when the stored file predates the field', () => {
    writeFileSync(file, JSON.stringify({ version: 1, asr: { language: 'auto', backend: 'local' } }), 'utf8');
    const s = new SettingsStore(file, fakeCipher);
    expect(s.data.asr.backend).toBe('local'); // stored choice wins
    expect(s.data.asr.localRealtime?.model).toBe('fun-asr-nano'); // defaults fill the gap
  });

  it('localRealtime model patch round-trips without touching other slots', () => {
    const s = new SettingsStore(file, fakeCipher);
    s.applyPatch({
      asr: { backend: 'local-realtime', localRealtime: { model: 'paraformer-zh-streaming' } },
    });
    const s2 = new SettingsStore(file, fakeCipher);
    expect(s2.data.asr.backend).toBe('local-realtime');
    expect(s2.data.asr.localRealtime?.model).toBe('paraformer-zh-streaming');
    expect(s2.getPublic().asr.localRealtime.model).toBe('paraformer-zh-streaming');
  });

  it('stores a nested cloud ASR provider + key, round-trips, and never leaks it', () => {
    const s1 = new SettingsStore(file, fakeCipher);
    s1.applyPatch({
      asr: { backend: 'cloud', cloud: { baseUrl: 'https://api.xiaomimimo.com/v1', model: 'mimo-v2.5-asr', apiKey: 'sk-mimo' } },
    });
    expect(s1.getCloudAsrApiKey()).toBe('sk-mimo');
    expect(JSON.stringify(s1.getPublic())).not.toContain('sk-mimo');

    const s2 = new SettingsStore(file, fakeCipher);
    expect(s2.data.asr.backend).toBe('cloud');
    expect(s2.data.asr.cloud?.model).toBe('mimo-v2.5-asr');
    expect(s2.getCloudAsrApiKey()).toBe('sk-mimo');
  });

  it('cloud patch does not clobber sibling asr fields', () => {
    const s = new SettingsStore(file, fakeCipher);
    s.applyPatch({ asr: { language: 'chinese' } });
    s.applyPatch({ asr: { cloud: { model: 'mimo-v2.5-asr' } } });
    expect(s.data.asr.language).toBe('chinese');
    expect(s.data.asr.cloud?.model).toBe('mimo-v2.5-asr');
  });

  it('clears the api key when set to empty string', () => {
    const s = new SettingsStore(file, fakeCipher);
    s.applyPatch({ llm: { apiKey: 'sk-x' } });
    s.applyPatch({ llm: { apiKey: '' } });
    expect(s.data.llm.apiKeyEnc).toBeUndefined();
    expect(s.getPublic().llm.apiKeySet).toBe(false);
  });

  it('defaults ui theme=dark and fontScale=medium (16px answer body)', () => {
    const s = new SettingsStore(file, fakeCipher);
    expect(s.data.ui.theme).toBe('dark');
    expect(s.data.ui.fontScale).toBe('medium');
    expect(s.getPublic().ui.theme).toBe('dark');
    expect(s.getPublic().ui.fontScale).toBe('medium');
  });

  it('theme/fontScale patch round-trips and fills defaults for older files', () => {
    writeFileSync(file, JSON.stringify({ version: 1, ui: { stealth: false } }), 'utf8');
    const s = new SettingsStore(file, fakeCipher);
    expect(s.data.ui.stealth).toBe(false); // stored choice wins
    expect(s.data.ui.theme).toBe('dark'); // defaults fill the gap
    s.applyPatch({ ui: { theme: 'light', fontScale: 'large' } });
    const s2 = new SettingsStore(file, fakeCipher);
    expect(s2.data.ui.theme).toBe('light');
    expect(s2.data.ui.fontScale).toBe('large');
    expect(s2.data.ui.stealth).toBe(false); // sibling untouched
  });

  it('merges unknown/missing sections gracefully (migration-friendly)', () => {
    writeFileSync(file, JSON.stringify({ version: 1, llm: { model: 'custom-model' } }), 'utf8');
    const s = new SettingsStore(file, fakeCipher);
    expect(s.data.llm.model).toBe('custom-model');
    expect(s.data.ui.hotkeyToggle).toBe(process.platform === 'darwin' ? 'Command+B' : 'Control+B');
    expect(s.data.asr.language).toBe('auto');
  });

  it('partial patch does not clobber sibling fields', () => {
    const s = new SettingsStore(file, fakeCipher);
    s.applyPatch({ llm: { apiKey: 'sk-1' } });
    s.applyPatch({ llm: { model: 'deepseek-v4-pro' } });
    expect(s.getLlmApiKey()).toBe('sk-1');
    expect(s.data.llm.model).toBe('deepseek-v4-pro');
  });

  it('round-trips the macOS input device used for the other-party channel', () => {
    const s = new SettingsStore(file, fakeCipher);
    s.applyPatch({ audio: { themDeviceId: 'blackhole-2ch' } });

    const s2 = new SettingsStore(file, fakeCipher);
    expect(s2.data.audio.themDeviceId).toBe('blackhole-2ch');
    expect(s2.getPublic().audio.themDeviceId).toBe('blackhole-2ch');
  });
});

// ---------------------------------------------------------------- v2 schema

/** a realistic pre-v2 file: real ciphertexts, cloud realtime ASR, custom vision */
const V1_FILE = {
  version: 1,
  llm: {
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    answerLang: 'chinese',
    answerWithVision: false,
    apiKeyEnc: 'enc:c2stZGVlcHNlZWs=',
  },
  vision: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-2.5-flash',
    proxyUrl: '127.0.0.1:7897',
    apiKeyEnc: 'enc:c2stZ2VtaW5p',
  },
  asr: {
    language: 'auto',
    backend: 'cloud-realtime',
    cloud: {},
    realtime: {
      baseUrl: 'wss://dashscope.aliyuncs.com/api-ws/v1/inference',
      model: 'fun-asr-realtime',
      apiKeyEnc: 'enc:c2stYWxpeXVu',
    },
    localRealtime: { model: 'fun-asr-nano' },
  },
  ui: {
    stealth: false,
    hotkeyToggle: 'Alt+Q',
    hotkeyShot: 'Alt+W',
    opacity: 0.8,
    fontScale: 'large',
    theme: 'light',
    lang: 'en',
  },
  audio: { micEnabled: true, micDeviceId: 'mic-1', themDeviceId: 'them-1' },
};

describe('migrateSettingsV1ToV2 (pure)', () => {
  it('preserves every configured field, ciphertexts byte-for-byte', () => {
    const v2 = migrateSettingsV1ToV2(V1_FILE);
    expect(v2.version).toBe(2);
    expect(v2.llm.apiKeyEnc).toBe(V1_FILE.llm.apiKeyEnc);
    expect(v2.vision.apiKeyEnc).toBe(V1_FILE.vision.apiKeyEnc);
    expect(v2.asr.realtime?.apiKeyEnc).toBe(V1_FILE.asr.realtime.apiKeyEnc);
    expect(v2.llm.baseUrl).toBe(V1_FILE.llm.baseUrl);
    expect(v2.vision.proxyUrl).toBe('127.0.0.1:7897');
    expect(v2.asr.backend).toBe('cloud-realtime');
    expect(v2.asr.realtime?.baseUrl).toBe(V1_FILE.asr.realtime.baseUrl);
    expect(v2.ui).toEqual(V1_FILE.ui);
    expect(v2.audio).toEqual(V1_FILE.audio);
  });

  it('grandfathers existing users past the wizard', () => {
    const v2 = migrateSettingsV1ToV2(V1_FILE);
    expect(v2.onboarding.completed).toBe(true);
    expect(v2.onboarding.schemaVersion).toBe(1);
    // never claims a plan the user did not pick
    expect(v2.onboarding.selectedPlan).toBeUndefined();
  });

  it('infers providerId from the catalog by exact baseUrl+model', () => {
    const v2 = migrateSettingsV1ToV2(V1_FILE);
    expect(v2.llm.providerId).toBe('deepseek');
    expect(v2.vision.providerId).toBe('gemini');
    expect(v2.asr.providerId).toBe('aliyun-dashscope-cn');
  });

  it('falls back to custom for unknown endpoints', () => {
    const v2 = migrateSettingsV1ToV2({
      ...V1_FILE,
      llm: { ...V1_FILE.llm, baseUrl: 'https://relay.example.com/v1', model: 'gpt-whatever' },
      vision: { baseUrl: 'https://relay.example.com/v1', model: 'vl-whatever' },
      asr: {
        ...V1_FILE.asr,
        realtime: { baseUrl: 'wss://relay.example.com/ws', model: 'rt-whatever' },
      },
    });
    expect(v2.llm.providerId).toBe('custom');
    expect(v2.vision.providerId).toBe('custom');
    expect(v2.asr.providerId).toBe('custom');
  });

  it('leaves asr.providerId absent for local backends and unset vision', () => {
    const v2 = migrateSettingsV1ToV2({
      version: 1,
      asr: { language: 'auto', backend: 'local-realtime', localRealtime: { model: 'fun-asr-nano' } },
    });
    expect(v2.asr.providerId).toBeUndefined();
    expect(v2.vision.providerId).toBeUndefined();
  });

  it('does not invent an apiKeyHint it cannot compute', () => {
    const v2 = migrateSettingsV1ToV2(V1_FILE);
    expect(v2.llm.apiKeyHint).toBeUndefined();
    expect(v2.asr.realtime?.apiKeyHint).toBeUndefined();
  });

  it('fills missing sections from the defaults', () => {
    const v2 = migrateSettingsV1ToV2({ version: 1, llm: { model: 'custom-model' } });
    expect(v2.llm.model).toBe('custom-model');
    expect(v2.llm.baseUrl).toBe('https://api.deepseek.com/v1');
    expect(v2.asr.language).toBe('auto');
    expect(v2.audio.micEnabled).toBe(false);
  });

  it('throws on input that is not a JSON object', () => {
    expect(() => migrateSettingsV1ToV2(null)).toThrow();
    expect(() => migrateSettingsV1ToV2('nope')).toThrow();
    expect(() => migrateSettingsV1ToV2([1, 2, 3])).toThrow();
  });
});

describe('SettingsStore v1 -> v2 load path', () => {
  it('migrates on load, backs the original up to settings.json.bak and rewrites v2', () => {
    const original = JSON.stringify(V1_FILE, null, 2);
    writeFileSync(file, original, 'utf8');

    const s = new SettingsStore(file, fakeCipher);
    expect(s.migratedFromV1).toBe(true);
    expect(s.data.version).toBe(2);
    expect(s.data.onboarding.completed).toBe(true);

    // the v1 original is recoverable, byte-for-byte
    expect(readFileSync(`${file}.bak`, 'utf8')).toBe(original);

    // the live file is v2 and still carries the ciphertexts
    const onDisk = JSON.parse(readFileSync(file, 'utf8')) as SettingsFile;
    expect(onDisk.version).toBe(2);
    expect(onDisk.llm.apiKeyEnc).toBe(V1_FILE.llm.apiKeyEnc);
    expect(onDisk.asr.realtime?.apiKeyEnc).toBe(V1_FILE.asr.realtime.apiKeyEnc);
    expect(s.getLlmApiKey()).toBe('sk-deepseek');
    expect(s.getRealtimeAsrApiKey()).toBe('sk-aliyun');

    // reloading the migrated file is a no-op
    const s2 = new SettingsStore(file, fakeCipher);
    expect(s2.migratedFromV1).toBe(false);
    expect(s2.data).toEqual(s.data);
  });

  it('treats a file without a version field as v1', () => {
    writeFileSync(file, JSON.stringify({ llm: { model: 'legacy' } }), 'utf8');
    const s = new SettingsStore(file, fakeCipher);
    expect(s.migratedFromV1).toBe(true);
    expect(s.data.llm.model).toBe('legacy');
    expect(s.data.onboarding.completed).toBe(true);
  });

  it('never overwrites an existing .bak', () => {
    writeFileSync(file, JSON.stringify(V1_FILE), 'utf8');
    writeFileSync(`${file}.bak`, 'an older original', 'utf8');
    new SettingsStore(file, fakeCipher);
    expect(readFileSync(`${file}.bak`, 'utf8')).toBe('an older original');
  });

  it('keeps a corrupt file untouched and boots with defaults', () => {
    const corrupt = '{"llm": {broken json';
    writeFileSync(file, corrupt, 'utf8');
    const s = new SettingsStore(file, fakeCipher);
    expect(s.data).toEqual(defaultSettings());
    expect(s.migratedFromV1).toBe(false);
    expect(readFileSync(file, 'utf8')).toBe(corrupt);
    expect(existsSync(`${file}.bak`)).toBe(false);
  });

  it('keeps the original untouched when migration throws (valid JSON, wrong shape)', () => {
    const weird = '"not an object"';
    writeFileSync(file, weird, 'utf8');
    const s = new SettingsStore(file, fakeCipher);
    expect(s.data).toEqual(defaultSettings());
    expect(s.data.onboarding.completed).toBe(false);
    expect(readFileSync(file, 'utf8')).toBe(weird);
    expect(existsSync(`${file}.bak`)).toBe(false);
  });

  it('loads a v2 file without migrating or backing it up', () => {
    const v2: SettingsFile = {
      ...defaultSettings(),
      onboarding: { schemaVersion: 1, completed: false, lastStep: 3, selectedPlan: 'recommended' },
    };
    writeFileSync(file, JSON.stringify(v2), 'utf8');
    const s = new SettingsStore(file, fakeCipher);
    expect(s.migratedFromV1).toBe(false);
    expect(existsSync(`${file}.bak`)).toBe(false);
    expect(s.data.onboarding).toEqual({
      schemaVersion: 1,
      completed: false,
      lastStep: 3,
      selectedPlan: 'recommended',
    });
  });
});

describe('SettingsStore onboarding + key hints', () => {
  it('persists wizard progress without ever completing onboarding', () => {
    const s = new SettingsStore(file, fakeCipher);
    const state = s.saveOnboardingProgress({ lastStep: 2, selectedPlan: 'mimo-simple' });
    expect(state).toEqual({
      schemaVersion: 1,
      completed: false,
      lastStep: 2,
      selectedPlan: 'mimo-simple',
    });
    const s2 = new SettingsStore(file, fakeCipher);
    expect(s2.data.onboarding.lastStep).toBe(2);
    expect(s2.data.onboarding.completed).toBe(false);
  });

  it('completes onboarding with a timestamp and the chosen plan', () => {
    const s = new SettingsStore(file, fakeCipher);
    const state = s.completeOnboarding({ selectedPlan: 'recommended' });
    expect(state.completed).toBe(true);
    expect(state.selectedPlan).toBe('recommended');
    expect(Date.parse(state.completedAt!)).not.toBeNaN();

    const s2 = new SettingsStore(file, fakeCipher);
    expect(s2.data.onboarding.completed).toBe(true);
    expect(s2.getPublic().onboarding.completed).toBe(true);
  });

  it('lets the main window dismiss the upgrade notice', () => {
    writeFileSync(file, JSON.stringify(V1_FILE), 'utf8');
    const s = new SettingsStore(file, fakeCipher);
    expect(s.getOnboarding().dismissedUpgradePrompt).toBeUndefined();
    s.saveOnboardingProgress({ dismissedUpgradePrompt: true });
    expect(new SettingsStore(file, fakeCipher).data.onboarding.dismissedUpgradePrompt).toBe(true);
  });

  it('computes the key hint main-side and never exposes more than 4 characters', () => {
    expect(apiKeyHint('sk-abcdefgh')).toBe('efgh');
    expect(apiKeyHint('ab')).toBe('ab');
    expect(apiKeyHint('')).toBeUndefined();

    const s = new SettingsStore(file, fakeCipher);
    s.applyPatch({ llm: { apiKey: 'sk-topsecret-9911' } });
    expect(s.data.llm.apiKeyHint).toBe('9911');
    const pub = s.getPublic();
    expect(pub.llm.apiKeyHint).toBe('9911');
    expect(JSON.stringify(pub)).not.toContain('sk-topsecret-9911');
  });

  it('clears the hint and verification when a key is deleted', () => {
    const s = new SettingsStore(file, fakeCipher);
    s.applyPatch({
      asr: {
        realtime: {
          baseUrl: 'wss://dashscope.aliyuncs.com/api-ws/v1/inference',
          model: 'fun-asr-realtime',
          apiKey: 'sk-aliyun-4321',
          verification: { lastTestOk: true, lastTestCode: 'OK' },
        },
      },
    });
    expect(s.data.asr.realtime?.apiKeyHint).toBe('4321');
    expect(s.getPublic().asr.realtime.verification?.lastTestCode).toBe('OK');

    s.applyPatch({ asr: { realtime: { apiKey: '' } } });
    expect(s.data.asr.realtime?.apiKeyHint).toBeUndefined();
    expect(s.data.asr.realtime?.apiKeyEnc).toBeUndefined();
    // a key change invalidates the previous test result
    expect(s.data.asr.realtime?.verification).toBeUndefined();
  });

  it('round-trips providerId and verification through the public settings', () => {
    const s = new SettingsStore(file, fakeCipher);
    s.applyPatch({
      llm: {
        providerId: 'deepseek',
        verification: { lastTestOk: true, lastTestCode: 'OK', latencyMs: 120 },
      },
      asr: { providerId: 'aliyun-dashscope-cn' },
    });
    const pub = s.getPublic();
    expect(pub.version).toBe(2);
    expect(pub.llm.providerId).toBe('deepseek');
    expect(pub.llm.verification).toEqual({ lastTestOk: true, lastTestCode: 'OK', latencyMs: 120 });
    expect(pub.asr.providerId).toBe('aliyun-dashscope-cn');
  });
});
