/**
 * First-run wizard shell: progress indicator, persistent chrome and the step
 * machine 欢迎 ─ 方案 ─ 服务配置 ─ 连接测试 ─ 完成.
 *
 * Contracts this component owns:
 *  - API keys are saved per card (each save touches only that provider's slot),
 *    but the PLAN — backend, base URLs, models, providerIds, audio devices —
 *    is written as ONE settings patch on completion, because every `asr.*`
 *    patch rebuilds the ASR engine;
 *  - 保存并稍后继续 persists lastStep + selectedPlan and closes the window; the
 *    next launch resumes on that step (main quits when the wizard closes before
 *    completion — accepted Phase 2 behaviour, the tray lands in Phase 4);
 *  - the 中文/English toggle writes ui.lang immediately, so the language the
 *    user picks here is the language the app starts in;
 *  - 高级配置与本地模式 completes onboarding WITHOUT touching any setting, so
 *    the user lands in the main window with the full settings panel.
 */
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import type {
  AppInfo,
  OnboardingPlan,
  PublicSettings,
  ThemeMode,
  UiLang,
} from '../../shared/protocol';
import { getSetupDict, type SetupDict } from './i18n';
import { buildPlanPatch, keyPatchForSlot, mergeKeyPatches, planDefinition, type KeySlot } from '../../shared/onboardingPlans';
import { WelcomeStep } from './steps/WelcomeStep';
import { PlanStep } from './steps/PlanStep';
import { ProviderStep, slotState } from './steps/ProviderStep';
import { ConnectionStep } from './steps/ConnectionStep';
import { CompleteStep } from './steps/CompleteStep';

const FIRST_STEP = 1;
const LAST_STEP = 5;
const HELP_URL = 'https://github.com/JWM0203/MeetingCopilot';

/** dev/QA hook: `?step=4` jumps straight to a step so every screen can be
 * screenshotted (electron/setupWindow.ts sets it from MC_SETUP_STEP). */
function stepFromQuery(): number | null {
  const raw = new URLSearchParams(window.location.search).get('step');
  if (!raw) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= FIRST_STEP && n <= LAST_STEP ? n : null;
}

function applyTheme(theme: ThemeMode): void {
  const resolved =
    theme === 'system'
      ? window.matchMedia('(prefers-color-scheme: light)').matches
        ? 'light'
        : 'dark'
      : theme;
  document.documentElement.dataset.theme = resolved;
}

/** every requirement the chosen plan puts on 「完成」 */
function completionBlocked(
  plan: OnboardingPlan,
  settings: PublicSettings,
  audioOk: boolean,
): boolean {
  const def = planDefinition(plan);
  if (plan === 'advanced') return false;
  if (def.asr && !slotState(settings, def.asr.slot).configured) return true;
  if (def.llm && !slotState(settings, def.llm.slot).configured) return true;
  return !audioOk;
}

export function OnboardingApp() {
  const [step, setStep] = useState(FIRST_STEP);
  const [lang, setLang] = useState<UiLang>('zh');
  const [plan, setPlan] = useState<OnboardingPlan>('recommended');
  const [shareMimoKey, setShareMimoKey] = useState(true);
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [audioOk, setAudioOk] = useState(false);
  const [micEnabled, setMicEnabled] = useState(false);
  const [micDeviceId, setMicDeviceId] = useState('');
  const [themDeviceId, setThemDeviceId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const t: SetupDict = useMemo(() => getSetupDict(lang), [lang]);

  // ---- boot: settings + onboarding progress + app info ----
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const [s, o, a] = await Promise.all([
          window.mcSetup.getSettings(),
          window.mcSetup.getOnboarding(),
          window.mcSetup.getAppInfo(),
        ]);
        if (!alive) return;
        setSettings(s);
        setInfo(a);
        setLang(s.ui.lang);
        applyTheme(s.ui.theme);
        setMicEnabled(s.audio.micEnabled);
        setMicDeviceId(s.audio.micDeviceId ?? '');
        setThemDeviceId(s.audio.themDeviceId ?? '');
        if (o.selectedPlan && o.selectedPlan !== 'advanced') setPlan(o.selectedPlan);
        const forced = stepFromQuery();
        if (forced) setStep(forced);
        else if (o.lastStep && o.lastStep >= FIRST_STEP && o.lastStep <= LAST_STEP) {
          setStep(o.lastStep);
        }
      } catch (e) {
        if (alive) setError(t.common.bootFail((e as Error).message));
      }
    })();
    return () => {
      alive = false;
    };
    // boot once; `t` is only read for the failure message
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleLang = useCallback(async () => {
    const next: UiLang = lang === 'zh' ? 'en' : 'zh';
    setLang(next);
    try {
      setSettings(await window.mcSetup.setSettings({ ui: { lang: next } }));
    } catch {
      /* the wizard still renders in the new language; the patch retries on完成 */
    }
  }, [lang]);

  const saveAndExit = useCallback(async () => {
    try {
      await window.mcSetup.saveOnboardingProgress({ lastStep: step, selectedPlan: plan });
    } finally {
      window.close();
    }
  }, [step, plan]);

  const openHelp = useCallback(() => {
    void window.mcSetup.openExternal(HELP_URL);
  }, []);

  /** one settings patch per card save; a shared key hits two slots at once */
  const saveKey = useCallback(async (slots: KeySlot[], apiKey: string) => {
    const patch = slots
      .map((slot) => keyPatchForSlot(slot, apiKey))
      .reduce((acc, p) => mergeKeyPatches(acc, p));
    setSettings(await window.mcSetup.setSettings(patch));
  }, []);

  /** 高级配置与本地模式: complete with NO settings change */
  const finishAdvanced = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await window.mcSetup.completeOnboarding({ selectedPlan: 'advanced' });
    } catch (e) {
      setError(t.complete.applyFail((e as Error).message));
      setBusy(false);
    }
  }, [t]);

  /** 进入 MeetingCopilot: the single batched plan patch, then completion */
  const finish = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await window.mcSetup.setSettings(
        buildPlanPatch(plan, {
          micEnabled,
          micDeviceId,
          themDeviceId: info?.platform === 'darwin' ? themDeviceId : undefined,
          lang,
        }),
      );
      await window.mcSetup.completeOnboarding({ selectedPlan: plan });
    } catch (e) {
      setError(t.complete.applyFail((e as Error).message));
      setBusy(false);
    }
  }, [plan, micEnabled, micDeviceId, themDeviceId, lang, info, t]);

  if (!settings) {
    return (
      <div className="setup">
        <div className="setup-body">
          <p className="setup-sub">{error ?? t.common.loading}</p>
        </div>
      </div>
    );
  }

  const blocked = completionBlocked(plan, settings, audioOk);
  const nextDisabled = step === 4 && blocked;
  const stepLabels = [
    t.steps.welcome,
    t.steps.plan,
    t.steps.provider,
    t.steps.connection,
    t.steps.done,
  ];

  return (
    <div className="setup">
      <header className="setup-header">
        <div className="setup-header-top">
          <span className="setup-brand">
            MeetingCopilot
            {info ? ` · ${t.common.version(info.version, info.platform)}` : ''}
          </span>
          <button className="btn btn-sm" onClick={() => void toggleLang()}>
            {t.common.langToggle}
          </button>
        </div>
        <div className="setup-steps">
          {stepLabels.map((label, i) => {
            const n = i + 1;
            const cls = n === step ? ' is-current' : n < step ? ' is-done' : '';
            return (
              <Fragment key={label}>
                <div className={`setup-step${cls}`}>
                  <span className="setup-step-dot">{n < step ? '✓' : n}</span>
                  <span className="setup-step-label">{label}</span>
                </div>
                {n < LAST_STEP && <span className="setup-step-bar" />}
              </Fragment>
            );
          })}
        </div>
      </header>

      <main className="setup-body">
        {step === 1 && <WelcomeStep t={t} />}
        {step === 2 && (
          <PlanStep
            t={t}
            plan={plan}
            onPick={setPlan}
            shareMimoKey={shareMimoKey}
            onShareMimoKey={setShareMimoKey}
            onAdvanced={() => void finishAdvanced()}
          />
        )}
        {step === 3 && (
          <ProviderStep
            t={t}
            lang={lang}
            plan={plan}
            shareMimoKey={shareMimoKey}
            settings={settings}
            onSaveKey={saveKey}
            onOpenExternal={(url) => window.mcSetup.openExternal(url)}
            onReadClipboard={() => window.mcSetup.readClipboardText()}
          />
        )}
        {step === 4 && (
          <ConnectionStep
            t={t}
            plan={plan}
            settings={settings}
            platform={info?.platform ?? window.mcSetup.platform}
            audioOk={audioOk}
            onAudioOk={setAudioOk}
            micEnabled={micEnabled}
            onMicEnabled={setMicEnabled}
            micDeviceId={micDeviceId}
            onMicDeviceId={setMicDeviceId}
            themDeviceId={themDeviceId}
            onThemDeviceId={setThemDeviceId}
          />
        )}
        {step === 5 && (
          <CompleteStep
            t={t}
            lang={lang}
            plan={plan}
            settings={settings}
            micEnabled={micEnabled}
            busy={busy}
            error={error}
            onEnter={() => void finish()}
            onEnterAndImport={() => void finish()}
          />
        )}
        {step !== 5 && error && <div className="setup-error">{error}</div>}
      </main>

      <footer className="setup-footer">
        <div className="setup-footer-left">
          <button className="btn" disabled={step === FIRST_STEP} onClick={() => setStep((s) => s - 1)}>
            {t.common.back}
          </button>
          <button className="btn" onClick={() => void saveAndExit()}>
            {t.common.saveAndExit}
          </button>
          <button className="btn-link" onClick={openHelp}>
            {t.common.help}
          </button>
        </div>
        <div className="setup-footer-right">
          {nextDisabled && <span className="setup-footer-hint">{t.connection.blockedHint}</span>}
          {step < LAST_STEP && (
            <button
              className="btn btn-primary"
              disabled={nextDisabled || busy}
              onClick={() => setStep((s) => s + 1)}
            >
              {step === FIRST_STEP ? t.welcome.start : t.common.next}
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}
