import { useState } from 'react';
import type { AsrLanguage, FontScale, PublicSettings, ThemeMode } from '../../shared/protocol';

/** provider presets: pick to auto-fill base URL + a sensible model */
const TEXT_PRESETS: Record<string, { baseUrl: string; model: string }> = {
  'DeepSeek 快速·非思考 (deepseek-chat)': { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  'DeepSeek 思考·v4-flash': { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-v4-flash' },
  'DeepSeek 深度·v4-pro': { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-v4-pro' },
  'MiMo 快速 (mimo-v2.5-pro)': { baseUrl: 'https://api.xiaomimimo.com/v1', model: 'mimo-v2.5-pro' },
};
const VISION_PRESETS: Record<string, { baseUrl: string; model: string; proxy: string }> = {
  MiMo: { baseUrl: 'https://api.xiaomimimo.com/v1', model: 'mimo-v2.5', proxy: '' },
  Gemini: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-2.5-flash',
    proxy: '127.0.0.1:7897',
  },
};
const CLOUD_ASR_PRESETS: Record<string, { baseUrl: string; model: string }> = {
  MiMo: { baseUrl: 'https://api.xiaomimimo.com/v1', model: 'mimo-v2.5-asr' },
};
/** cloud streaming presets (backend 'cloud-realtime'; local streaming is its own backend) */
const REALTIME_ASR_PRESETS: Record<string, { baseUrl: string; model: string }> = {
  '阿里云 fun-asr-realtime（中英双优，逐字丝滑）': {
    baseUrl: 'wss://dashscope.aliyuncs.com/api-ws/v1/inference',
    model: 'fun-asr-realtime',
  },
  '阿里云 paraformer-realtime-v2': {
    baseUrl: 'wss://dashscope.aliyuncs.com/api-ws/v1/inference',
    model: 'paraformer-realtime-v2',
  },
};
/** local streaming models (backend 'local-realtime'; endpoint is fixed) */
const LOCAL_REALTIME_MODELS: Record<string, string> = {
  'fun-asr-nano': 'Fun-ASR-Nano（中英+标点，推荐）',
  'paraformer-zh-streaming': 'paraformer 流式（纯中文，字幕更跟手）',
};

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
  const [saving, setSaving] = useState(false);

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
        ui: { hotkeyToggle: hotkey.trim(), hotkeyShot: hotkeyShot.trim(), fontScale, theme },
      });
      onSaved(next);
    } finally {
      setSaving(false);
    }
  };

  const keyState = (set: boolean) => (set ? '（已设置）' : '（未设置）');

  return (
    <div className="settings">
      <div className="settings-section">文本大模型（回答/翻译）</div>
      <div className="settings-row">
        <label>快速预设（选择自动填入地址+模型，再填 key）</label>
        <select
          value=""
          onChange={(e) => {
            const p = TEXT_PRESETS[e.target.value];
            if (p) {
              setBaseUrl(p.baseUrl);
              setModel(p.model);
            }
          }}
        >
          <option value="">— 选择预设 —</option>
          {Object.keys(TEXT_PRESETS).map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </div>
      <div className="settings-row">
        <label>Base URL</label>
        <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} spellCheck={false} />
      </div>
      <div className="settings-row">
        <label>模型（DeepSeek 用 deepseek-chat；MiMo 用 mimo-v2.5-pro）</label>
        <input value={model} onChange={(e) => setModel(e.target.value)} spellCheck={false} />
      </div>
      <div className="settings-row">
        <label>API Key {keyState(settings.llm.apiKeySet)}</label>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={settings.llm.apiKeySet ? '留空则不修改' : 'sk-...'}
        />
      </div>

      <div className="settings-section">视觉模型（截图问答 / 多模态回答）</div>
      <div className="settings-hint">纯文本/多模态切换在标题栏；截图按钮仅多模态模式显示。</div>
      <div className="settings-row">
        <label>快速预设</label>
        <select
          value=""
          onChange={(e) => {
            const p = VISION_PRESETS[e.target.value];
            if (p) {
              setVisionBaseUrl(p.baseUrl);
              setVisionModel(p.model);
              setVisionProxy(p.proxy);
            }
          }}
        >
          <option value="">— 选择预设 —</option>
          {Object.keys(VISION_PRESETS).map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </div>
      <div className="settings-row">
        <label>Base URL（MiMo 直连 https://api.xiaomimimo.com/v1；Gemini 需填代理）</label>
        <input
          value={visionBaseUrl}
          onChange={(e) => setVisionBaseUrl(e.target.value)}
          spellCheck={false}
          placeholder="留空则截图问答不可用"
        />
      </div>
      <div className="settings-row">
        <label>视觉模型名（MiMo: mimo-v2.5；Gemini: gemini-2.5-flash；Qwen: qwen-vl-max）</label>
        <input value={visionModel} onChange={(e) => setVisionModel(e.target.value)} spellCheck={false} />
      </div>
      <div className="settings-row">
        <label>视觉 API Key {keyState(settings.vision.apiKeySet)}</label>
        <input
          type="password"
          value={visionApiKey}
          onChange={(e) => setVisionApiKey(e.target.value)}
          placeholder={settings.vision.apiKeySet ? '留空则不修改' : ''}
        />
      </div>
      <div className="settings-row">
        <label>视觉代理（被墙的模型如 Gemini 填 127.0.0.1:7897；MiMo 直连留空）</label>
        <input
          value={visionProxy}
          onChange={(e) => setVisionProxy(e.target.value)}
          spellCheck={false}
          placeholder="留空 = 直连"
        />
      </div>

      <div className="settings-section">转录（ASR）</div>
      <div className="settings-row">
        <label>转录后端</label>
        <select
          value={asrBackend}
          onChange={(e) =>
            setAsrBackend(e.target.value as 'local' | 'cloud' | 'cloud-realtime' | 'local-realtime')
          }
        >
          <optgroup label="本地（免费·隐私）">
            <option value="local-realtime">本地流式 FunASR（边说边出字，引擎自动启动，默认）</option>
            <option value="local">本地 Whisper turbo（离线兜底）</option>
          </optgroup>
          <optgroup label="云端（需 key）">
            <option value="cloud-realtime">云端流式（阿里云百炼，逐字丝滑）</option>
            <option value="cloud">云端按段（如 MiMo mimo-v2.5-asr）</option>
          </optgroup>
        </select>
      </div>
      {asrBackend === 'local-realtime' && (
        <div className="settings-row">
          <label>本地流式模型（免 key，选完保存即用）</label>
          <select value={rtLocalModel} onChange={(e) => setRtLocalModel(e.target.value)}>
            {Object.entries(LOCAL_REALTIME_MODELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      )}
      {asrBackend === 'cloud' && (
        <>
          <div className="settings-row">
            <label>快速预设</label>
            <select
              value=""
              onChange={(e) => {
                const p = CLOUD_ASR_PRESETS[e.target.value];
                if (p) {
                  setCloudBaseUrl(p.baseUrl);
                  setCloudModel(p.model);
                }
              }}
            >
              <option value="">— 选择预设 —</option>
              {Object.keys(CLOUD_ASR_PRESETS).map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </div>
          <div className="settings-row">
            <label>云端 ASR Base URL（MiMo: https://api.xiaomimimo.com/v1）</label>
            <input value={cloudBaseUrl} onChange={(e) => setCloudBaseUrl(e.target.value)} spellCheck={false} />
          </div>
          <div className="settings-row">
            <label>云端 ASR 模型（mimo-v2.5-asr）</label>
            <input value={cloudModel} onChange={(e) => setCloudModel(e.target.value)} spellCheck={false} />
          </div>
          <div className="settings-row">
            <label>云端 ASR API Key {keyState(settings.asr.cloud.apiKeySet)}</label>
            <input
              type="password"
              value={cloudApiKey}
              onChange={(e) => setCloudApiKey(e.target.value)}
              placeholder={settings.asr.cloud.apiKeySet ? '留空则不修改' : ''}
            />
          </div>
        </>
      )}
      {asrBackend === 'cloud-realtime' && (
        <>
          <div className="settings-row">
            <label>快速预设</label>
            <select
              value=""
              onChange={(e) => {
                const p = REALTIME_ASR_PRESETS[e.target.value];
                if (p) {
                  setRtBaseUrl(p.baseUrl);
                  setRtModel(p.model);
                }
              }}
            >
              <option value="">— 选择预设 —</option>
              {Object.keys(REALTIME_ASR_PRESETS).map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </div>
          <div className="settings-row">
            <label>云端流式 WebSocket 地址（wss://…/api-ws/v1/inference）</label>
            <input value={rtBaseUrl} onChange={(e) => setRtBaseUrl(e.target.value)} spellCheck={false} />
          </div>
          <div className="settings-row">
            <label>云端流式模型（fun-asr-realtime / paraformer-realtime-v2）</label>
            <input value={rtModel} onChange={(e) => setRtModel(e.target.value)} spellCheck={false} />
          </div>
          <div className="settings-row">
            <label>云端流式 API Key {keyState(settings.asr.realtime.apiKeySet)}</label>
            <input
              type="password"
              value={rtApiKey}
              onChange={(e) => setRtApiKey(e.target.value)}
              placeholder={settings.asr.realtime.apiKeySet ? '留空则不修改' : 'sk-…'}
            />
          </div>
        </>
      )}
      <div className="settings-row">
        <label>转录语言（本地后端用；云端一般自动识别）</label>
        <select value={language} onChange={(e) => setLanguage(e.target.value as AsrLanguage)}>
          <option value="auto">自动检测（推荐）</option>
          <option value="chinese">中文</option>
          <option value="english">英文</option>
        </select>
      </div>

      <div className="settings-section">外观</div>
      <div className="settings-row">
        <label>主题</label>
        <select value={theme} onChange={(e) => setTheme(e.target.value as ThemeMode)}>
          <option value="dark">深色</option>
          <option value="light">浅色</option>
          <option value="system">跟随系统</option>
        </select>
      </div>
      <div className="settings-row">
        <label>答案字号（只影响右栏答案正文）</label>
        <select value={fontScale} onChange={(e) => setFontScale(e.target.value as FontScale)}>
          <option value="small">小（13px）</option>
          <option value="medium">中（16px，默认）</option>
          <option value="large">大（19px）</option>
        </select>
      </div>

      <div className="settings-section">其他</div>
      <div className="settings-hint">
        麦克风开关/设备、答语言、多模态切换都在标题栏；简历/岗位JD 在右栏「📄简历」「📋JD」按会话导入（支持
        docx/pdf）。
      </div>
      <div className="settings-row">
        <label>呼出/隐藏快捷键</label>
        <input value={hotkey} onChange={(e) => setHotkey(e.target.value)} spellCheck={false} />
      </div>
      <div className="settings-row">
        <label>截图快捷键（框选截图问答，如 Control+Shift+S）</label>
        <input value={hotkeyShot} onChange={(e) => setHotkeyShot(e.target.value)} spellCheck={false} />
      </div>
      <div className="settings-actions">
        <button className="btn btn-primary" onClick={() => void save()} disabled={saving}>
          {saving ? '保存中…' : '保存'}
        </button>
        <button className="btn" onClick={onClose}>
          取消
        </button>
      </div>
    </div>
  );
}
