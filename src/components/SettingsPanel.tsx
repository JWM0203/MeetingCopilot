import { useState } from 'react';
import type { AsrLanguage, FontScale, PublicSettings, ThemeMode, UiLang } from '../../shared/protocol';
import { useT } from '../i18n';

/** provider presets: pick to auto-fill base URL + a sensible model.
 * Labels are bilingual — the UI language picks which one renders. */
const TEXT_PRESETS: { zh: string; en: string; baseUrl: string; model: string }[] = [
  {
    zh: 'DeepSeek 快速·非思考 (deepseek-chat)',
    en: 'DeepSeek fast · non-thinking (deepseek-chat)',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
  },
  {
    zh: 'DeepSeek 思考·v4-flash',
    en: 'DeepSeek thinking · v4-flash',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-v4-flash',
  },
  {
    zh: 'DeepSeek 深度·v4-pro',
    en: 'DeepSeek deep · v4-pro',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-v4-pro',
  },
  {
    zh: 'MiMo 快速 (mimo-v2.5-pro)',
    en: 'MiMo fast (mimo-v2.5-pro)',
    baseUrl: 'https://api.xiaomimimo.com/v1',
    model: 'mimo-v2.5-pro',
  },
];
const VISION_PRESETS: { zh: string; en: string; baseUrl: string; model: string; proxy: string }[] = [
  { zh: 'MiMo', en: 'MiMo', baseUrl: 'https://api.xiaomimimo.com/v1', model: 'mimo-v2.5', proxy: '' },
  {
    zh: 'Gemini',
    en: 'Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-2.5-flash',
    proxy: '127.0.0.1:7897',
  },
];
const CLOUD_ASR_PRESETS: { zh: string; en: string; baseUrl: string; model: string }[] = [
  { zh: 'MiMo', en: 'MiMo', baseUrl: 'https://api.xiaomimimo.com/v1', model: 'mimo-v2.5-asr' },
];
/** cloud streaming presets (backend 'cloud-realtime'; local streaming is its own backend) */
const REALTIME_ASR_PRESETS: { zh: string; en: string; baseUrl: string; model: string }[] = [
  {
    zh: '阿里云 fun-asr-realtime（中英双优，逐字丝滑）',
    en: 'Aliyun fun-asr-realtime (great zh+en, word-by-word)',
    baseUrl: 'wss://dashscope.aliyuncs.com/api-ws/v1/inference',
    model: 'fun-asr-realtime',
  },
  {
    zh: '阿里云 paraformer-realtime-v2',
    en: 'Aliyun paraformer-realtime-v2',
    baseUrl: 'wss://dashscope.aliyuncs.com/api-ws/v1/inference',
    model: 'paraformer-realtime-v2',
  },
];
/** local streaming models (backend 'local-realtime'; endpoint is fixed) */
const LOCAL_REALTIME_MODELS: { value: string; zh: string; en: string }[] = [
  { value: 'fun-asr-nano', zh: 'Fun-ASR-Nano（中英+标点，推荐）', en: 'Fun-ASR-Nano (zh+en, punctuation; recommended)' },
  {
    value: 'paraformer-zh-streaming',
    zh: 'paraformer 流式（纯中文，字幕更跟手）',
    en: 'paraformer streaming (Chinese-only, snappier captions)',
  },
];

/**
 * BYOK settings (R7): OpenAI-compatible providers for text / vision / cloud
 * ASR, plus transcription language and hotkey. API keys are write-only — we
 * only ever display whether one is set.
 */
export function SettingsPanel({
  settings,
  onSaved,
  onClose,
}: {
  settings: PublicSettings;
  onSaved: (s: PublicSettings) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [baseUrl, setBaseUrl] = useState(settings.llm.baseUrl);
  const [model, setModel] = useState(settings.llm.model);
  const [apiKey, setApiKey] = useState('');
  const [language, setLanguage] = useState<AsrLanguage>(settings.asr.language);
  const [hotkey, setHotkey] = useState(settings.ui.hotkeyToggle);
  const [visionBaseUrl, setVisionBaseUrl] = useState(settings.vision.baseUrl ?? '');
  const [visionModel, setVisionModel] = useState(settings.vision.model ?? '');
  const [visionApiKey, setVisionApiKey] = useState('');
  const [visionProxy, setVisionProxy] = useState(settings.vision.proxyUrl ?? '');
  const [asrBackend, setAsrBackend] = useState<'local' | 'cloud' | 'cloud-realtime' | 'local-realtime'>(
    settings.asr.backend,
  );
  const [cloudBaseUrl, setCloudBaseUrl] = useState(settings.asr.cloud.baseUrl ?? '');
  const [cloudModel, setCloudModel] = useState(settings.asr.cloud.model ?? '');
  const [cloudApiKey, setCloudApiKey] = useState('');
  const [rtBaseUrl, setRtBaseUrl] = useState(settings.asr.realtime.baseUrl ?? '');
  const [rtModel, setRtModel] = useState(settings.asr.realtime.model ?? '');
  const [rtApiKey, setRtApiKey] = useState('');
  const [rtLocalModel, setRtLocalModel] = useState(settings.asr.localRealtime.model ?? 'fun-asr-nano');
  const [hotkeyShot, setHotkeyShot] = useState(settings.ui.hotkeyShot);
  const [fontScale, setFontScale] = useState<FontScale>(settings.ui.fontScale ?? 'medium');
  const [theme, setTheme] = useState<ThemeMode>(settings.ui.theme ?? 'dark');
  const [uiLang, setUiLang] = useState<UiLang>(settings.ui.lang);
  const [saving, setSaving] = useState(false);

  /** preset display name in the current UI language */
  const name = (p: { zh: string; en: string }) => (t.uiLang === 'zh' ? p.zh : p.en);

  const save = async () => {
    setSaving(true);
    try {
      const next = await window.mc.setSettings({
        llm: {
          baseUrl: baseUrl.trim(),
          model: model.trim(),
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        },
        vision: {
          baseUrl: visionBaseUrl.trim(),
          model: visionModel.trim(),
          proxyUrl: visionProxy.trim(),
          ...(visionApiKey.trim() ? { apiKey: visionApiKey.trim() } : {}),
        },
        asr: {
          language,
          backend: asrBackend,
          cloud: {
            baseUrl: cloudBaseUrl.trim(),
            model: cloudModel.trim(),
            ...(cloudApiKey.trim() ? { apiKey: cloudApiKey.trim() } : {}),
          },
          realtime: {
            baseUrl: rtBaseUrl.trim(),
            model: rtModel.trim(),
            ...(rtApiKey.trim() ? { apiKey: rtApiKey.trim() } : {}),
          },
          localRealtime: { model: rtLocalModel },
        },
        ui: { hotkeyToggle: hotkey.trim(), hotkeyShot: hotkeyShot.trim(), fontScale, theme, lang: uiLang },
      });
      onSaved(next);
    } finally {
      setSaving(false);
    }
  };

  const keyState = (set: boolean) => (set ? t.settings.keySet : t.settings.keyUnset);

  return (
    <div className="settings">
      <div className="settings-section">{t.settings.textSection}</div>
      <div className="settings-row">
        <label>{t.settings.presetLabel}</label>
        <select
          value=""
          onChange={(e) => {
            const p = TEXT_PRESETS[Number(e.target.value)];
            if (p) {
              setBaseUrl(p.baseUrl);
              setModel(p.model);
            }
          }}
        >
          <option value="">{t.settings.presetPick}</option>
          {TEXT_PRESETS.map((p, i) => (
            <option key={p.model + p.baseUrl} value={i}>
              {name(p)}
            </option>
          ))}
        </select>
      </div>
      <div className="settings-row">
        <label>{t.settings.baseUrl}</label>
        <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} spellCheck={false} />
      </div>
      <div className="settings-row">
        <label>{t.settings.model}</label>
        <input value={model} onChange={(e) => setModel(e.target.value)} spellCheck={false} />
      </div>
      <div className="settings-row">
        <label>
          {t.settings.apiKey} {keyState(settings.llm.apiKeySet)}
        </label>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={settings.llm.apiKeySet ? t.settings.keyKeepPlaceholder : 'sk-...'}
        />
      </div>

      <div className="settings-section">{t.settings.visionSection}</div>
      <div className="settings-hint">{t.settings.visionHint}</div>
      <div className="settings-row">
        <label>{t.settings.visionPreset}</label>
        <select
          value=""
          onChange={(e) => {
            const p = VISION_PRESETS[Number(e.target.value)];
            if (p) {
              setVisionBaseUrl(p.baseUrl);
              setVisionModel(p.model);
              setVisionProxy(p.proxy);
            }
          }}
        >
          <option value="">{t.settings.presetPick}</option>
          {VISION_PRESETS.map((p, i) => (
            <option key={p.model + p.baseUrl} value={i}>
              {name(p)}
            </option>
          ))}
        </select>
      </div>
      <div className="settings-row">
        <label>{t.settings.visionBaseUrl}</label>
        <input
          value={visionBaseUrl}
          onChange={(e) => setVisionBaseUrl(e.target.value)}
          spellCheck={false}
          placeholder={t.settings.visionBaseUrlPlaceholder}
        />
      </div>
      <div className="settings-row">
        <label>{t.settings.visionModel}</label>
        <input value={visionModel} onChange={(e) => setVisionModel(e.target.value)} spellCheck={false} />
      </div>
      <div className="settings-row">
        <label>
          {t.settings.visionApiKey} {keyState(settings.vision.apiKeySet)}
        </label>
        <input
          type="password"
          value={visionApiKey}
          onChange={(e) => setVisionApiKey(e.target.value)}
          placeholder={settings.vision.apiKeySet ? t.settings.keyKeepPlaceholder : ''}
        />
      </div>
      <div className="settings-row">
        <label>{t.settings.visionProxy}</label>
        <input
          value={visionProxy}
          onChange={(e) => setVisionProxy(e.target.value)}
          spellCheck={false}
          placeholder={t.settings.visionProxyPlaceholder}
        />
      </div>

      <div className="settings-section">{t.settings.asrSection}</div>
      {window.mc.platform === 'darwin' && (
        <div className="settings-hint">{t.settings.macAudioHint}</div>
      )}
      <div className="settings-row">
        <label>{t.settings.asrBackend}</label>
        <select
          value={asrBackend}
          onChange={(e) =>
            setAsrBackend(e.target.value as 'local' | 'cloud' | 'cloud-realtime' | 'local-realtime')
          }
        >
          <optgroup label={t.settings.asrLocalGroup}>
            <option value="local-realtime">{t.settings.asrLocalRealtime}</option>
            <option value="local">{t.settings.asrLocalWhisper}</option>
          </optgroup>
          <optgroup label={t.settings.asrCloudGroup}>
            <option value="cloud-realtime">{t.settings.asrCloudRealtime}</option>
            <option value="cloud">{t.settings.asrCloudSeg}</option>
          </optgroup>
        </select>
      </div>
      {asrBackend === 'local-realtime' && (
        <div className="settings-row">
          <label>{t.settings.localRtModel}</label>
          <select value={rtLocalModel} onChange={(e) => setRtLocalModel(e.target.value)}>
            {LOCAL_REALTIME_MODELS.map((m) => (
              <option key={m.value} value={m.value}>
                {name(m)}
              </option>
            ))}
          </select>
        </div>
      )}
      {asrBackend === 'cloud' && (
        <>
          <div className="settings-row">
            <label>{t.settings.cloudPreset}</label>
            <select
              value=""
              onChange={(e) => {
                const p = CLOUD_ASR_PRESETS[Number(e.target.value)];
                if (p) {
                  setCloudBaseUrl(p.baseUrl);
                  setCloudModel(p.model);
                }
              }}
            >
              <option value="">{t.settings.presetPick}</option>
              {CLOUD_ASR_PRESETS.map((p, i) => (
                <option key={p.model + p.baseUrl} value={i}>
                  {name(p)}
                </option>
              ))}
            </select>
          </div>
          <div className="settings-row">
            <label>{t.settings.cloudBaseUrl}</label>
            <input value={cloudBaseUrl} onChange={(e) => setCloudBaseUrl(e.target.value)} spellCheck={false} />
          </div>
          <div className="settings-row">
            <label>{t.settings.cloudModel}</label>
            <input value={cloudModel} onChange={(e) => setCloudModel(e.target.value)} spellCheck={false} />
          </div>
          <div className="settings-row">
            <label>
              {t.settings.cloudApiKey} {keyState(settings.asr.cloud.apiKeySet)}
            </label>
            <input
              type="password"
              value={cloudApiKey}
              onChange={(e) => setCloudApiKey(e.target.value)}
              placeholder={settings.asr.cloud.apiKeySet ? t.settings.keyKeepPlaceholder : ''}
            />
          </div>
        </>
      )}
      {asrBackend === 'cloud-realtime' && (
        <>
          <div className="settings-row">
            <label>{t.settings.cloudPreset}</label>
            <select
              value=""
              onChange={(e) => {
                const p = REALTIME_ASR_PRESETS[Number(e.target.value)];
                if (p) {
                  setRtBaseUrl(p.baseUrl);
                  setRtModel(p.model);
                }
              }}
            >
              <option value="">{t.settings.presetPick}</option>
              {REALTIME_ASR_PRESETS.map((p, i) => (
                <option key={p.model + p.baseUrl} value={i}>
                  {name(p)}
                </option>
              ))}
            </select>
          </div>
          <div className="settings-row">
            <label>{t.settings.rtBaseUrl}</label>
            <input value={rtBaseUrl} onChange={(e) => setRtBaseUrl(e.target.value)} spellCheck={false} />
          </div>
          <div className="settings-row">
            <label>{t.settings.rtModel}</label>
            <input value={rtModel} onChange={(e) => setRtModel(e.target.value)} spellCheck={false} />
          </div>
          <div className="settings-row">
            <label>
              {t.settings.rtApiKey} {keyState(settings.asr.realtime.apiKeySet)}
            </label>
            <input
              type="password"
              value={rtApiKey}
              onChange={(e) => setRtApiKey(e.target.value)}
              placeholder={settings.asr.realtime.apiKeySet ? t.settings.keyKeepPlaceholder : 'sk-…'}
            />
          </div>
        </>
      )}
      <div className="settings-row">
        <label>{t.settings.asrLanguage}</label>
        <select value={language} onChange={(e) => setLanguage(e.target.value as AsrLanguage)}>
          <option value="auto">{t.settings.asrLangAuto}</option>
          <option value="chinese">{t.settings.asrLangZh}</option>
          <option value="english">{t.settings.asrLangEn}</option>
        </select>
      </div>

      <div className="settings-section">{t.settings.appearanceSection}</div>
      <div className="settings-row">
        <label>{t.settings.uiLang}</label>
        <select value={uiLang} onChange={(e) => setUiLang(e.target.value as UiLang)}>
          <option value="zh">中文</option>
          <option value="en">English</option>
        </select>
      </div>
      <div className="settings-row">
        <label>{t.settings.theme}</label>
        <select value={theme} onChange={(e) => setTheme(e.target.value as ThemeMode)}>
          <option value="dark">{t.settings.themeDark}</option>
          <option value="light">{t.settings.themeLight}</option>
          <option value="system">{t.settings.themeSystem}</option>
        </select>
      </div>
      <div className="settings-row">
        <label>{t.settings.fontScaleLabel}</label>
        <select value={fontScale} onChange={(e) => setFontScale(e.target.value as FontScale)}>
          <option value="small">{t.settings.fontSmall}</option>
          <option value="medium">{t.settings.fontMedium}</option>
          <option value="large">{t.settings.fontLarge}</option>
        </select>
      </div>

      <div className="settings-section">{t.settings.otherSection}</div>
      <div className="settings-hint">{t.settings.otherHint}</div>
      <div className="settings-row">
        <label>{t.settings.hotkeyToggle}</label>
        <input value={hotkey} onChange={(e) => setHotkey(e.target.value)} spellCheck={false} />
      </div>
      <div className="settings-row">
        <label>{t.settings.hotkeyShot}</label>
        <input value={hotkeyShot} onChange={(e) => setHotkeyShot(e.target.value)} spellCheck={false} />
      </div>
      <div className="settings-actions">
        <button className="btn btn-primary" onClick={() => void save()} disabled={saving}>
          {saving ? t.settings.saving : t.settings.save}
        </button>
        <button className="btn" onClick={onClose}>
          {t.settings.cancel}
        </button>
      </div>
    </div>
  );
}
