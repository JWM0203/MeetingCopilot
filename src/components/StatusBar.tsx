import type { AsrUiState, HudStats } from '../App';

const STATE_LABEL: Record<AsrUiState['workerState'], string> = {
  loading: '模型加载中…',
  listening: '聆听中',
  speech: '对方说话中…',
  transcribing: '转写中…',
  stopped: '已停止',
};

export function StatusBar({
  asr,
  capturing,
  hud,
}: {
  asr: AsrUiState;
  capturing: boolean;
  hud?: HudStats;
}) {
  return (
    <footer className="statusbar">
      <div className="status-left">
        {asr.phase === 'loading' && <span className="tag tag-wait">模型加载中…</span>}
        {asr.phase === 'error' && <span className="tag tag-err">引擎故障</span>}
        {asr.phase === 'ready' && (
          <>
            <span className={capturing ? 'tag tag-live' : 'tag'}>
              {capturing ? STATE_LABEL[asr.workerState] : '未采集'}
            </span>
            <span className={asr.gpuSuspect ? 'tag tag-err' : 'tag tag-ok'}>
              {asr.gpuSuspect ? 'GPU 未生效!' : 'GPU'}
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
        <div className="status-hud" title="话落→出字延迟（末条 / p50 / p95）与推理耗时">
          {hud.lastE2eMs !== undefined ? (
            <>
              <span>{(hud.lastE2eMs / 1000).toFixed(2)}s</span>
              <span className="dim">
                p50 {hud.p50 !== undefined ? (hud.p50 / 1000).toFixed(2) : '–'} · p95{' '}
                {hud.p95 !== undefined ? (hud.p95 / 1000).toFixed(2) : '–'}
              </span>
              <span className="dim">推理 {hud.lastInferMs}ms</span>
            </>
          ) : (
            <span className="dim">HUD 等待首句…</span>
          )}
        </div>
      )}
    </footer>
  );
}
