/**
 * The documentation URLs the app is allowed to open, in one place.
 *
 * Every renderer that shows a 「查看完整教程」 button reads them from here, so a
 * moved file is one edit instead of a hunt through components. All of them live
 * on github.com, which is already in EXTERNAL_LINK_ALLOWED_HOSTS — the main
 * process refuses anything else (electron/externalLinks.ts), and
 * test/docsLinks.spec.ts asserts that every entry below survives that check.
 *
 * Pure data: importable from the main window, the setup wizard and tests.
 */
import type { UiLang } from './protocol';

const REPO = 'https://github.com/JWM0203/MeetingCopilot';
/** the docs are read on GitHub, so link the rendered blob, not a raw file */
const BLOB = `${REPO}/blob/main`;

/** a document that exists in both UI languages */
export interface LocalizedDoc {
  zh: string;
  en: string;
}

export const DOCS = {
  repo: REPO,
  issues: `${REPO}/issues`,
  releases: `${REPO}/releases/latest`,
  license: `${BLOB}/LICENSE`,
  quickStart: {
    zh: `${BLOB}/docs/user/QUICK_START.zh-CN.md`,
    en: `${BLOB}/docs/user/QUICK_START.en.md`,
  },
  apiKeys: {
    zh: `${BLOB}/docs/user/API_KEYS.zh-CN.md`,
    en: `${BLOB}/docs/user/API_KEYS.en.md`,
  },
  troubleshooting: {
    zh: `${BLOB}/docs/user/TROUBLESHOOTING.zh-CN.md`,
    en: `${BLOB}/docs/user/TROUBLESHOOTING.en.md`,
  },
  installWindows: {
    zh: `${BLOB}/docs/user/INSTALL_WINDOWS.zh-CN.md`,
    en: `${BLOB}/docs/user/INSTALL_WINDOWS.en.md`,
  },
  /** macOS packaging is not shipped yet, so this guide is English-only */
  installMacos: `${BLOB}/docs/user/INSTALL_MACOS.en.md`,
  /** developer-facing platform setup (python envs, BlackHole, stealth) */
  windowsSetup: {
    zh: `${BLOB}/docs/windows/SETUP.zh-CN.md`,
    en: `${BLOB}/docs/windows/SETUP.md`,
  },
  macosSetup: {
    zh: `${BLOB}/docs/macos/SETUP.zh-CN.md`,
    en: `${BLOB}/docs/macos/SETUP.md`,
  },
} as const;

/** pick the language variant; a single-language doc is returned as-is */
export function docUrl(doc: LocalizedDoc | string, lang: UiLang): string {
  return typeof doc === 'string' ? doc : doc[lang];
}

/** every URL this module can hand to the main process (used by the test) */
export function allDocUrls(): string[] {
  return Object.values(DOCS).flatMap((v) => (typeof v === 'string' ? [v] : [v.zh, v.en]));
}
