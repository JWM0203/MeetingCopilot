import type { UiLang } from '../shared/protocol';

/**
 * Main-process user-facing strings (dialogs, overlay tip, high-visibility
 * errors). The renderer chrome has its own dictionary in src/i18n.tsx; deep
 * engine diagnostics stay untranslated on purpose.
 */
const zh = {
  regionTip: '拖动框选要识别的区域 · Esc 取消',
  kbImportTitle: '导入个人知识库（.md / .txt）',
  docFilter: '文档',
  pickResumeTitle: '导入我的简历（md/txt/docx/pdf）',
  pickJdTitle: '导入岗位JD（md/txt/docx/pdf）',
  noApiKey: '未设置 API Key，请在设置里填入后重试',
  noApiKeyShort: '未设置 API Key',
  noVision: '未配置视觉模型：请在设置里填 Vision Base URL / 模型 / Key（如 MiMo / Gemini）',
  sidecarFail: (msg: string) => `本地 FunASR 引擎启动失败：${msg}`,
};

type MainDict = typeof zh;

const en: MainDict = {
  regionTip: 'Drag to select a region · Esc to cancel',
  kbImportTitle: 'Import personal knowledge base (.md / .txt)',
  docFilter: 'Documents',
  pickResumeTitle: 'Import my resume (md/txt/docx/pdf)',
  pickJdTitle: 'Import the job description (md/txt/docx/pdf)',
  noApiKey: 'API Key not set — add one in Settings and retry',
  noApiKeyShort: 'API Key not set',
  noVision: 'Vision model not configured: set the Vision Base URL / model / key in Settings (e.g. MiMo / Gemini)',
  sidecarFail: (msg: string) => `Local FunASR engine failed to start: ${msg}`,
};

const dicts: Record<UiLang, MainDict> = { zh, en };

export function mainStrings(lang: UiLang | undefined, fallback: UiLang): MainDict {
  return dicts[lang ?? fallback];
}
