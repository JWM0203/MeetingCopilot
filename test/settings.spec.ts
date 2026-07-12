import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { SettingsStore, defaultSettings, type SecretCipher } from '../electron/settings';

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
