/**
 * Preload for the setup window ONLY.
 *
 * The main window's preload exposes the whole app (PCM streaming, screen
 * capture, LLM, sessions...). The wizard needs none of that, so it gets its
 * own bridge with the smallest surface that can drive onboarding. Anything
 * missing here is a capability the wizard simply does not have.
 *
 * SELF-CONTAINED BY CONSTRUCTION: this file must not import anything at
 * runtime except `electron`. Preloads run sandboxed, where `require` is a
 * polyfill that cannot resolve sibling files — and any module shared with
 * electron/preload.ts would be hoisted by rollup into out/preload/chunks/,
 * breaking BOTH preloads (window.mc / window.mcSetup silently undefined).
 * Hence the local channel table below instead of importing `IPC`.
 */
import { contextBridge, ipcRenderer } from 'electron';
import type {
  AppInfo,
  IPC,
  OnboardingCompletePayload,
  OnboardingProgressPatch,
  OnboardingState,
  ProviderTestRequest,
  ProviderTestResult,
  PublicSettings,
  SettingsPatch,
} from '../shared/protocol';

/**
 * The wizard's slice of the IPC table. The `satisfies` clause is the guard:
 * shared/protocol.ts declares `IPC` with `as const`, so every wire name below
 * is compared against its literal type. Renaming a channel there without
 * updating this table is a compile error, not a runtime mystery.
 */
const CH = {
  onboardingGet: 'onboarding:get',
  onboardingSaveProgress: 'onboarding:save-progress',
  onboardingComplete: 'onboarding:complete',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  externalOpen: 'app:open-external',
  clipboardReadText: 'app:clipboard-read',
  appGetInfo: 'app:get-info',
  providerTest: 'provider:test',
} as const satisfies Pick<
  typeof IPC,
  | 'onboardingGet'
  | 'onboardingSaveProgress'
  | 'onboardingComplete'
  | 'settingsGet'
  | 'settingsSet'
  | 'externalOpen'
  | 'clipboardReadText'
  | 'appGetInfo'
  | 'providerTest'
>;

export interface McSetupApi {
  readonly platform: NodeJS.Platform;
  getOnboarding(): Promise<OnboardingState>;
  /** 保存并稍后继续: persist lastStep / selectedPlan without completing */
  saveOnboardingProgress(patch: OnboardingProgressPatch): Promise<OnboardingState>;
  /** finish the wizard: main persists it, opens the app and closes this window */
  completeOnboarding(payload?: OnboardingCompletePayload): Promise<OnboardingState>;
  /** public settings only — decrypted keys never cross this bridge */
  getSettings(): Promise<PublicSettings>;
  /** the wizard writes the chosen plan through the ordinary settings patch */
  setSettings(patch: SettingsPatch): Promise<PublicSettings>;
  /** allowlisted https documentation links; false = refused by main */
  openExternal(url: string): Promise<boolean>;
  /** only ever called from an explicit 「从剪贴板粘贴」 click */
  readClipboardText(): Promise<string>;
  getAppInfo(): Promise<AppInfo>;
  /** 「保存并测试连接」: one real provider round-trip, run only when the user
   * asks for it. The candidate key goes main-side and stays there. */
  providerTest(req: ProviderTestRequest): Promise<ProviderTestResult>;
}

const api: McSetupApi = {
  platform: process.platform,
  getOnboarding: () => ipcRenderer.invoke(CH.onboardingGet),
  saveOnboardingProgress: (patch) => ipcRenderer.invoke(CH.onboardingSaveProgress, patch),
  completeOnboarding: (payload = {}) => ipcRenderer.invoke(CH.onboardingComplete, payload),
  getSettings: () => ipcRenderer.invoke(CH.settingsGet),
  setSettings: (patch) => ipcRenderer.invoke(CH.settingsSet, patch),
  openExternal: (url) => ipcRenderer.invoke(CH.externalOpen, url),
  readClipboardText: () => ipcRenderer.invoke(CH.clipboardReadText),
  getAppInfo: () => ipcRenderer.invoke(CH.appGetInfo),
  providerTest: (req) => ipcRenderer.invoke(CH.providerTest, req),
};

contextBridge.exposeInMainWorld('mcSetup', api);
