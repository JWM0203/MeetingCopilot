/**
 * Step 5 完成 — the summary of what is about to be written, then the handover.
 *
 * The primary button applies the whole plan as ONE settings patch (every
 * `asr.*` patch rebuilds the ASR engine, so the wizard must not split it) and
 * only then marks onboarding complete; main creates the overlay window and
 * starts ASR from the freshly written settings.
 */
import { planDefinition } from '../../../shared/onboardingPlans';
import type { OnboardingPlan, PublicSettings, UiLang } from '../../../shared/protocol';
import type { SetupDict } from '../i18n';

export interface CompleteStepProps {
  t: SetupDict;
  lang: UiLang;
  plan: OnboardingPlan;
  settings: PublicSettings;
  micEnabled: boolean;
  busy: boolean;
  error: string | null;
  onEnter: () => void;
  onEnterAndImport: () => void;
}

export function CompleteStep({
  t,
  lang,
  plan,
  settings,
  micEnabled,
  busy,
  error,
  onEnter,
  onEnterAndImport,
}: CompleteStepProps) {
  const def = planDefinition(plan);
  const presetName = (which: 'asr' | 'llm') => {
    const slot = which === 'asr' ? def.asr : def.llm;
    if (!slot) return t.complete.llmSkipped;
    return lang === 'zh' ? slot.preset.nameZh : slot.preset.nameEn;
  };

  return (
    <div>
      <h1 className="setup-h1">{t.complete.title}</h1>
      <p className="setup-lead">{t.complete.body}</p>

      <section className="setup-card">
        <div className="check-list">
          <div className="check-row is-ok">
            <span className="check-mark">✓</span>
            <span className="check-label">{t.complete.planLabel}</span>
            <span className="check-value">{t.planNames[plan]}</span>
          </div>
          <div className={`check-row ${def.asr ? 'is-ok' : 'is-na'}`}>
            <span className="check-mark">{def.asr ? '✓' : '–'}</span>
            <span className="check-label">{t.complete.asrLabel}</span>
            <span className="check-value">{presetName('asr')}</span>
          </div>
          <div className={`check-row ${def.llm ? 'is-ok' : 'is-na'}`}>
            <span className="check-mark">{def.llm ? '✓' : '–'}</span>
            <span className="check-label">{t.complete.llmLabel}</span>
            <span className="check-value">{presetName('llm')}</span>
          </div>
          <div className={`check-row ${micEnabled ? 'is-ok' : 'is-na'}`}>
            <span className="check-mark">{micEnabled ? '✓' : '–'}</span>
            <span className="check-label">{t.complete.micLabel}</span>
            <span className="check-value">
              {micEnabled ? t.connection.enabled : t.connection.disabled}
            </span>
          </div>
          <div className="check-row is-na">
            <span className="check-mark">–</span>
            <span className="check-label">{t.connection.rowVision}</span>
            <span className="check-value">{t.connection.visionUnset}</span>
          </div>
          <div className={`check-row ${settings.llm.apiKeySet || !def.llm ? 'is-ok' : 'is-todo'}`}>
            <span className="check-mark">
              {settings.llm.apiKeySet || !def.llm ? '✓' : '○'}
            </span>
            <span className="check-label">{t.connection.rowLlmKey}</span>
            <span className="check-value">
              {def.llm
                ? settings.llm.apiKeySet
                  ? t.connection.saved
                  : t.connection.unsaved
                : t.connection.notNeeded}
            </span>
          </div>
        </div>
      </section>

      <p className="setup-footnote">{t.complete.tip}</p>

      <div className="key-actions" style={{ marginTop: 18 }}>
        <button className="btn btn-primary" disabled={busy} onClick={onEnter}>
          {busy ? t.complete.applying : t.complete.enter}
        </button>
        <button className="btn" disabled={busy} onClick={onEnterAndImport}>
          {t.complete.importMaterial}
        </button>
      </div>

      {error && <div className="setup-error">{error}</div>}
    </div>
  );
}
