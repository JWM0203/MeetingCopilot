import type { AsrUiState, HudStats } from '../App';
import { chipTone, type ChipTone, type ServiceHealthReport } from '../../shared/healthState';
import { useT } from '../i18n';

/** one glyph per tone — the chips must stay readable at 10px in a 28px bar */
const MARK: Record<ChipTone, string> = { ok: '✓', busy: '…', bad: '!', none: '–' };

export function StatusBar({
  asr,
  capturing,
  hud,
  health,
  onOpenHealth,
}: {
  asr: AsrUiState;
  capturing: boolean;
  hud?: HudStats;
  /** absent until the settings snapshot has loaded */
  health?: ServiceHealthReport;
  onOpenHealth: () => void;
}) {
  const t = useT();
  return (
    <footer className="statusbar">
      <div className="status-left">
        {asr.phase === 'loading' && <span className="tag tag-wait">{t.status.state.loading}</span>}
        {asr.phase === 'error' && <span className="tag tag-err">{t.status.engineError}</span>}
        {asr.phase === 'ready' && (
          <>
            <span className={capturing ? 'tag tag-live' : 'tag'}>
              {capturing ? t.status.state[asr.workerState] : t.status.idle}
            </span>
            <span className={asr.gpuSuspect ? 'tag tag-err' : 'tag tag-ok'}>
              {asr.gpuSuspect ? t.status.gpuBad : t.status.gpuOk}
            </span>
          </>
        )}
        {asr.lastError && (
          <span className="tag tag-err" title={asr.lastError}>
            ⚠
          </span>
        )}
        {/* compact service health; the panel behind it carries the detail */}
        {health && (
          <button className="health-chips" onClick={onOpenHealth} title={t.health.chipsTitle}>
            <span className={`health-chip is-${chipTone(health.asr)}`}>
              {t.health.chipAsr} {MARK[chipTone(health.asr)]}
            </span>
            <span className={`health-chip is-${chipTone(health.llm)}`}>
              {t.health.chipLlm} {MARK[chipTone(health.llm)]}
            </span>
            <span className={`health-chip is-${chipTone(health.audio)}`}>
              {t.health.chipAudio} {MARK[chipTone(health.audio)]}
            </span>
          </button>
        )}
      </div>
      {hud && (
        <div className="status-hud" title={t.status.hudTitle}>
          {hud.lastE2eMs !== undefined ? (
            <>
              <span>{(hud.lastE2eMs / 1000).toFixed(2)}s</span>
              <span className="dim">
                p50 {hud.p50 !== undefined ? (hud.p50 / 1000).toFixed(2) : '–'} · p95{' '}
                {hud.p95 !== undefined ? (hud.p95 / 1000).toFixed(2) : '–'}
              </span>
              <span className="dim">
                {t.status.infer} {hud.lastInferMs}ms
              </span>
            </>
          ) : (
            <span className="dim">{t.status.hudWaiting}</span>
          )}
        </div>
      )}
    </footer>
  );
}
