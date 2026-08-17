/**
 * 诊断信息 overlay (spec §E.5).
 *
 * The report itself is built by the main process (electron/diagnostics.ts) and
 * is deliberately safe to paste into a public issue: no keys, no transcripts,
 * no resume/JD text, and every recorded error line passes through
 * shared/redact.ts first. This panel only shows it, copies it, and offers the
 * two places a user might take it — the data folder and the issue tracker.
 *
 * It is read-only on purpose: an editable box invites a user to "clean it up"
 * and hand us a report that no longer describes their machine.
 */
import { useCallback, useEffect, useState } from 'react';
import { useT } from '../i18n';

const ISSUES_URL = 'https://github.com/JWM0203/MeetingCopilot/issues';

export function DiagnosticsPanel({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [report, setReport] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    setNotice(null);
    setReport(null);
    void window.mc
      .getDiagnostics()
      .then(setReport)
      .catch((e: Error) => setError(t.diagnostics.loadFail(e.message)));
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const copy = async () => {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(report);
      setNotice(t.diagnostics.copied);
    } catch (e) {
      setNotice(t.diagnostics.copyFail((e as Error).message));
    }
  };

  const openLogs = async () => {
    const ok = await window.mc.openLogsFolder();
    if (!ok) setNotice(t.diagnostics.openLogsFail);
  };

  return (
    <div className="settings diagnostics-panel">
      <div className="settings-section">{t.diagnostics.title}</div>
      <div className="settings-hint">{t.diagnostics.intro}</div>

      {error ? (
        <div className="settings-warn">{error}</div>
      ) : (
        <textarea
          className="diagnostics-report"
          readOnly
          spellCheck={false}
          value={report ?? t.diagnostics.loading}
        />
      )}

      {notice && <div className="settings-inline-hint">{notice}</div>}

      <div className="settings-actions">
        <button className="btn btn-primary" disabled={!report} onClick={() => void copy()}>
          {t.diagnostics.copy}
        </button>
        <button className="btn" onClick={() => void openLogs()}>
          {t.diagnostics.openLogs}
        </button>
        <button className="btn" onClick={() => void window.mc.openExternal(ISSUES_URL)}>
          {t.diagnostics.issues}
        </button>
        <button className="btn" onClick={load}>
          {t.diagnostics.refresh}
        </button>
        <button className="btn" onClick={onClose}>
          {t.diagnostics.close}
        </button>
      </div>
    </div>
  );
}
