import { useEffect, useState } from 'react';
import type { PublicSettings, RagDocumentStatus, RagStatus } from '../../shared/protocol';
import { useT } from '../i18n';
import { ragActionState } from '../../shared/ragUiState';

export { ragActionState } from '../../shared/ragUiState';

const initialStatus = (enabled: boolean): RagStatus => ({
  phase: enabled ? 'loading' : 'disabled',
  enabled,
  fileCount: 0,
  chunkCount: 0,
  failedCount: 0,
});

export function KnowledgeBaseSettings({
  settings,
  onSettingsChange,
}: {
  settings: PublicSettings['rag'];
  onSettingsChange(next: PublicSettings): void;
}) {
  const t = useT();
  const copy = t.settings.rag;
  const [status, setStatus] = useState<RagStatus>(() => initialStatus(settings.enabled));
  const [documents, setDocuments] = useState<RagDocumentStatus[]>([]);
  const [error, setError] = useState('');
  const [confirmRebuild, setConfirmRebuild] = useState(false);
  const actions = ragActionState({ ...settings, phase: status.phase });

  const refreshDocuments = async () => {
    try {
      setDocuments(await window.mc.getRagDocuments());
    } catch {
      setDocuments([]);
    }
  };

  useEffect(() => {
    let live = true;
    void window.mc.getRagStatus().then((next) => {
      if (live) setStatus(next);
      if (live && next.phase === 'ready') void refreshDocuments();
      else if (live) setDocuments([]);
    });
    const off = window.mc.onRagStatus((next) => {
      if (!live) return;
      setStatus(next);
      if (next.phase === 'ready') void refreshDocuments();
      else setDocuments([]);
    });
    return () => {
      live = false;
      off();
    };
  }, []);

  const persist = async (patch: { enabled?: boolean; rootPath?: string }) => {
    setError('');
    try {
      onSettingsChange(await window.mc.setSettings({ rag: patch }));
      if (patch.enabled === false) setDocuments([]);
    } catch (cause) {
      setError((cause as Error).message);
    }
  };

  const chooseRoot = async () => {
    setError('');
    try {
      const rootPath = await window.mc.chooseRagRoot();
      if (rootPath) await persist({ rootPath });
    } catch (cause) {
      setError((cause as Error).message);
    }
  };

  const scan = async (rebuild: boolean) => {
    setError('');
    setConfirmRebuild(false);
    try {
      setStatus(await window.mc.scanRag(rebuild));
      await refreshDocuments();
    } catch (cause) {
      setError((cause as Error).message);
    }
  };

  const failed = documents.filter((document) => document.state === 'error');
  const progress =
    status.total && status.processed !== undefined
      ? ` ${Math.min(status.processed, status.total)}/${status.total}`
      : '';

  return (
    <section className="rag-settings" aria-labelledby="rag-settings-title">
      <div className="settings-section" id="rag-settings-title">
        {copy.section}
      </div>
      <div className="settings-hint">{copy.localNote}</div>
      <div className="settings-hint">{copy.remoteDisclosure}</div>

      <div className="settings-row">
        <label>{copy.folder}</label>
        <div className="rag-folder-line">
          <span className="rag-folder" title={settings.rootPath}>
            {settings.rootPath || copy.noFolder}
          </span>
          <button className="btn btn-sm" type="button" onClick={() => void chooseRoot()}>
            {copy.chooseFolder}
          </button>
        </div>
      </div>

      <div className="settings-row rag-toggle-row">
        <label className="rag-toggle">
          <input
            type="checkbox"
            checked={settings.enabled}
            disabled={!actions.canEnable}
            onChange={(event) => void persist({ enabled: event.target.checked })}
          />
          <span>{settings.enabled ? copy.enabled : copy.disabled}</span>
        </label>
        {!settings.rootPath && <span className="settings-inline-hint">{copy.chooseFirst}</span>}
      </div>

      <div className="rag-status" aria-live="polite">
        <span className={`rag-status-dot rag-status-${status.phase}`} />
        <strong>{copy.phases[status.phase]}</strong>
        <span>{progress}</span>
        <span className="rag-stats">
          {copy.stats(status.fileCount, status.chunkCount, status.failedCount)}
        </span>
      </div>

      {status.lastUpdatedAt && (
        <div className="settings-inline-hint">
          {copy.lastUpdate}: {new Date(status.lastUpdatedAt).toLocaleString(t.locale)}
        </div>
      )}

      {(error || status.message) && <div className="settings-warn">{error || status.message}</div>}

      {failed.length > 0 && (
        <div className="rag-failures">
          <div className="settings-inline-hint">{copy.failedFiles}</div>
          {failed.map((document) => (
            <div className="rag-failure" key={document.id}>
              <span title={document.relativePath}>{document.name}</span>
              <code>{document.errorCode ?? 'UNKNOWN'}</code>
              {document.errorMessage && <span>{document.errorMessage}</span>}
            </div>
          ))}
        </div>
      )}

      <div className="rag-actions">
        <button
          className="btn btn-sm"
          type="button"
          disabled={!actions.canScan}
          onClick={() => void scan(false)}
        >
          {status.phase === 'error' ? copy.retry : copy.rescan}
        </button>
        <button
          className="btn btn-sm"
          type="button"
          disabled={!actions.canRebuild}
          onClick={() => setConfirmRebuild(true)}
        >
          {copy.rebuild}
        </button>
      </div>

      {confirmRebuild && (
        <div className="settings-warn rag-confirm">
          <span>{copy.rebuildConfirm}</span>
          <div className="rag-actions">
            <button className="btn btn-sm" type="button" onClick={() => void scan(true)}>
              {copy.rebuildConfirmAction}
            </button>
            <button className="btn btn-sm" type="button" onClick={() => setConfirmRebuild(false)}>
              {copy.cancel}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
