import type { AsrUiState, HudStats } from '../App';
import { useT } from '../i18n';

export function StatusBar({
  asr,
  capturing,
  hud,
}: {
  asr: AsrUiState;
  capturing: boolean;
  hud?: HudStats;
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
