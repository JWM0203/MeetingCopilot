import { useEffect, useRef, useState } from 'react';
import type { PublicSettings } from '../../shared/protocol';
import type { RagStatus } from '../../shared/rag';
import { useT } from '../i18n';

const ACTIVE_PHASES = new Set(['downloading', 'loading', 'scanning', 'parsing', 'embedding']);

/** These explicitly labeled operations save immediately, independently of the settings draft. */
export function KnowledgeBaseSettings({ settings, onChanged }: {
  settings: PublicSettings;
  onChanged: (settings: PublicSettings) => void;
}) {
  const t = useT().rag;
  const [status, setStatus] = useState<RagStatus>();
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  // Toggling invalidates a pending scan's response (including its error).
  const scanGeneration = useRef(0);
  const scanPending = useRef(false);
  const [error, setError] = useState('');
  const mounted = useRef(true);
  const running = useRef(false);
  const supported = ['getRagStatus', 'onRagStatus', 'chooseRagRoot', 'scanRag', 'setSettings']
    .every((method) => typeof window.mc[method as keyof typeof window.mc] === 'function');
  useEffect(() => {
    mounted.current = true;
    if (!supported) return;
    let receivedEvent = false;
    const off = window.mc.onRagStatus((next) => {
      receivedEvent = true;
      if (mounted.current) setStatus(next);
    });
    void window.mc.getRagStatus().then((next) => {
      if (mounted.current && !receivedEvent) setStatus(next);
    }).catch(() => { if (mounted.current) setError(t.failed); });
    return () => { mounted.current = false; off(); };
  }, [supported, t.failed]);
  const run = async (action: () => Promise<void>) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError('');
    try { await action(); }
    catch { if (mounted.current) setError(t.failed); }
    finally { running.current = false; if (mounted.current) setBusy(false); }
  };
  const indexing = status && ACTIVE_PHASES.has(status.phase);
  const disabled = !supported || busy || scanning || !!indexing;
  const rebuild = async () => {
    if (scanPending.current) return;
    scanPending.current = true;
    const generation = ++scanGeneration.current;
    setScanning(true);
    setError('');
    try {
      const next = await window.mc.scanRag(true);
      if (mounted.current && generation === scanGeneration.current) setStatus(next);
    } catch {
      if (mounted.current && generation === scanGeneration.current) setError(t.failed);
    } finally {
      if (generation === scanGeneration.current) {
        scanPending.current = false;
        if (mounted.current) setScanning(false);
      }
    }
  };
  return <section className="rag-settings" aria-labelledby="rag-settings-title">
    <div id="rag-settings-title" className="settings-section">{t.title}</div>
    <p className="settings-hint">{t.disclosure}</p>
    <p className="settings-hint">{t.boundary}</p>
    <p className="settings-hint">{t.immediate}</p>
    {!supported && <p role="status">{t.unavailable}</p>}
    <label className="rag-check"><input type="checkbox" checked={settings.rag.enabled} disabled={!supported || busy} onChange={(e) => {
      const enabled = e.target.checked;
      ++scanGeneration.current;
      scanPending.current = false;
      setScanning(false);
      void run(async () => {
        const next = await window.mc.setSettings({ rag: { enabled } });
        if (mounted.current) onChanged(next);
        const current = await window.mc.getRagStatus();
        if (mounted.current) setStatus(current);
      });
    }} />{t.enable}</label>
    <p className="rag-root" title={settings.rag.rootPath}>{settings.rag.rootPath || t.noFolder}</p>
    <div className="settings-actions">
      <button className="btn btn-sm" disabled={disabled} onClick={() => void run(async () => {
        const rootPath = await window.mc.chooseRagRoot();
        if (!rootPath || !mounted.current) return;
        const next = await window.mc.setSettings({ rag: { rootPath } });
        if (mounted.current) { onChanged(next); setStatus(undefined); }
        const current = await window.mc.getRagStatus();
        if (mounted.current) setStatus(current);
      })}>{t.folder}</button>
      <button className="btn btn-sm" disabled={disabled || !settings.rag.enabled || !settings.rag.rootPath} onClick={() => void rebuild()}>{t.rebuild}</button>
    </div>
    <div role="status" aria-live="polite">
      {supported && (status ? <>
        <p>{t.phases[status.phase]}</p>
        <p>{t.counts(status.fileCount, status.chunkCount, status.failedCount)}</p>
        {status.modelProgress !== undefined && <p>{Math.round(status.modelProgress)}%</p>}
        {status.total !== undefined && <p>{status.processed ?? 0} / {status.total}</p>}
        {status.currentPath && <p className="rag-root">{status.currentPath}</p>}
        {status.message && <p>{status.message}</p>}
      </> : <p>{t.loading}</p>)}
    </div>
    {error && <p className="settings-warn" role="alert">{error}</p>}
  </section>;
}
