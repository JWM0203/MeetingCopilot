/**
 * Step 2 方案 — two cards, two secondary links.
 *
 * Deliberately free of Base URL / WebSocket URL / model id / proxy / python
 * paths / ports (SPEC §A): the plan is a product choice, not a connection
 * form. Local backends are NOT peer cards — they live behind the 「高级配置与
 * 本地模式」link, which leaves the wizard without touching any setting.
 */
import type { OnboardingPlan } from '../../../shared/protocol';
import type { SetupDict } from '../i18n';

export interface PlanStepProps {
  t: SetupDict;
  plan: OnboardingPlan;
  onPick: (plan: OnboardingPlan) => void;
  shareMimoKey: boolean;
  onShareMimoKey: (share: boolean) => void;
  /** 高级配置与本地模式: finish onboarding with no settings change */
  onAdvanced: () => void;
}

export function PlanStep({
  t,
  plan,
  onPick,
  shareMimoKey,
  onShareMimoKey,
  onAdvanced,
}: PlanStepProps) {
  return (
    <div>
      <h1 className="setup-h1">{t.plan.title}</h1>
      <p className="setup-sub">{t.plan.subtitle}</p>

      <div className="setup-plans">
        <div
          className={`plan-card${plan === 'recommended' ? ' is-selected' : ''}`}
          role="button"
          tabIndex={0}
          onClick={() => onPick('recommended')}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') onPick('recommended');
          }}
        >
          <div className="plan-card-head">
            <span className="plan-card-name">{t.plan.recommendedName}</span>
            <span className="tag tag-accent">{t.common.recommended}</span>
          </div>
          <div className="plan-card-summary">{t.plan.recommendedSummary}</div>
          <ul className="plan-card-bullets">
            {t.plan.recommendedBullets.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
          <div className="plan-card-note">{t.plan.recommendedNote}</div>
          <div className="plan-card-foot">
            <span className={plan === 'recommended' ? 'tag tag-ok' : 'tag'}>
              {plan === 'recommended' ? t.plan.selected : t.plan.select}
            </span>
          </div>
        </div>

        <div
          className={`plan-card${plan === 'mimo-simple' ? ' is-selected' : ''}`}
          role="button"
          tabIndex={0}
          onClick={() => onPick('mimo-simple')}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') onPick('mimo-simple');
          }}
        >
          <div className="plan-card-head">
            <span className="plan-card-name">{t.plan.mimoName}</span>
            <span className="tag tag-beta">{t.common.beta}</span>
          </div>
          <div className="plan-card-summary">{t.plan.mimoSummary}</div>
          <ul className="plan-card-bullets">
            {t.plan.mimoBullets.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
          <div className="plan-card-note">{t.plan.mimoNote}</div>
          <label className="plan-share" onClick={(e) => e.stopPropagation()}>
            <input
              type="checkbox"
              checked={shareMimoKey}
              onChange={(e) => {
                onPick('mimo-simple');
                onShareMimoKey(e.target.checked);
              }}
            />
            <span>{t.plan.mimoShareKey}</span>
          </label>
          <div className="plan-card-foot">
            <span className={plan === 'mimo-simple' ? 'tag tag-ok' : 'tag'}>
              {plan === 'mimo-simple' ? t.plan.selected : t.plan.select}
            </span>
          </div>
        </div>
      </div>

      <div className="setup-secondary-links">
        <button className="btn-link" onClick={() => onPick('transcription-only')}>
          {t.plan.transcriptionOnly}
          {plan === 'transcription-only' ? ` · ${t.plan.selected}` : ''}
        </button>
        <button className="btn-link" onClick={onAdvanced}>
          {t.plan.advanced}
        </button>
      </div>
      <p className="setup-footnote">{t.plan.advancedNote}</p>
    </div>
  );
}
