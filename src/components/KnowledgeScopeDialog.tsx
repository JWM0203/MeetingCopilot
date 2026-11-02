import { hintProps } from '../surfaceHints';
import { useEffect, useRef, useState } from 'react';
import type { RagDocumentStatus, RagScope } from '../../shared/rag';
import { useT } from '../i18n';

export function KnowledgeScopeDialog({ scope, documents, onSave, onClose }: {
  scope: RagScope;
  documents: RagDocumentStatus[];
  onSave: (scope: RagScope) => void;
  onClose: () => void;
}) {
  const t = useT().rag;
  const dialog = useRef<HTMLDialogElement>(null);
  const [enabled, setEnabled] = useState(scope.enabled);
  const [all, setAll] = useState(!scope.includePaths?.length);
  const [paths, setPaths] = useState<string[]>(scope.includePaths ?? []);
  const ready = documents.filter((doc) => doc.state === 'ready');
  const validPaths = paths.filter((path) => ready.some((doc) => doc.relativePath === path));
  const invalid = enabled && !all && validPaths.length === 0;
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return (
    <dialog ref={dialog} className="rag-scope-dialog" aria-labelledby="rag-scope-title" onCancel={onClose}>
      <h2 id="rag-scope-title">{t.scopeTitle}</h2>
      <p className="settings-hint">{t.disclosure}</p>
      <label className="rag-check"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />{t.scopeEnable}</label>
      <fieldset disabled={!enabled}>
        <label className="rag-check"><input type="radio" name="rag-scope" checked={all} onChange={() => setAll(true)} />{t.all}</label>
        <label className="rag-check"><input type="radio" name="rag-scope" checked={!all} onChange={() => setAll(false)} />{t.selected}</label>
        {ready.length === 0 && <p>{t.empty}</p>}
        <div className="rag-document-list">
          {ready.map((doc) => <label key={doc.id} className="rag-check">
            <input type="checkbox" disabled={all} checked={paths.includes(doc.relativePath)} onChange={(e) => setPaths(e.target.checked ? [...paths, doc.relativePath] : paths.filter((p) => p !== doc.relativePath))} />
            <span {...hintProps(doc.relativePath)}>{doc.relativePath}</span>
          </label>)}
        </div>
      </fieldset>
      {invalid && <p role="alert">{t.selectRequired}</p>}
      <div className="settings-actions">
        <button className="btn btn-primary" disabled={invalid} onClick={() => onSave({ enabled, includePaths: all ? [] : (enabled ? validPaths : paths) })}>{t.save}</button>
        <button className="btn" onClick={onClose}>{t.cancel}</button>
      </div>
    </dialog>
  );
}
