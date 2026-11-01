import { useEffect, useRef, useState } from 'react';
import type { KbSlot, StoredSession } from '../../shared/protocol';
import { sessionText } from '../../shared/sessionActions';
import { useT } from '../i18n';

export type TurnKind = 'segment' | 'continuous' | 'free' | 'translate' | 'vision';

export interface AnswerTurn {
  id: string;
  kind: TurnKind;
  label: string;
  text: string;
  status: 'streaming' | 'done' | 'error';
  error?: string;
  sources?: import('../../shared/rag').RagSourceRef[];
}

/**
 * 智能体 conversation panel (R4) with a multi-session bar. Answers ACCUMULATE
 * as a scrolling session (never replaced); each meeting is its own session
 * with its own knowledge base. The 📷 screenshot button only appears in
 * multimodal mode (it needs a vision model).
 */
export function AnswerSession({
  sessions,
  currentId,
  turns,
  resumeName,
  resumeChars,
  jdName,
  jdChars,
  notice,
  visionReady,
  answersReady,
  answersHint,
  onSwitch,
  onNew,
  onDelete,
  onUndoDelete,
  onOpenRagScope,
  onRename,
  onPickKb,
  onClearKb,
  onCancel,
  onRetry,
  onClear,
  onFreeAsk,
  onShotAsk,
}: {
  sessions: StoredSession[];
  currentId: string;
  turns: AnswerTurn[];
  resumeName?: string;
  resumeChars: number;
  jdName?: string;
  jdChars: number;
  /** transient parse warning (e.g. scanned PDF with no text layer) */
  notice?: string | null;
  visionReady: boolean;
  /** false = no LLM configured; asking is disabled with an explanation */
  answersReady: boolean;
  answersHint: string;
  onSwitch: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onUndoDelete?: () => void;
  onOpenRagScope?: () => void;
  onRename: (id: string, name: string) => void;
  onPickKb: (slot: KbSlot) => void;
  onClearKb: (slot: KbSlot) => void;
  onCancel: (id: string) => void;
  onRetry: (turn: AnswerTurn) => void;
  onClear: () => void;
  onFreeAsk: (question: string) => void;
  onShotAsk: (question: string, imageDataUrl?: string, sessionId?: string) => void;
}) {
  const t = useT();
  const boxRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const currentIdRef = useRef(currentId);
  currentIdRef.current = currentId;
  const [shotError, setShotError] = useState(false);
  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const currentName = sessions.find((s) => s.id === currentId)?.name ?? '';

  useEffect(() => {
    if (stick.current && boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight;
  });

  const onScroll = () => {
    const el = boxRef.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  };

  const submit = () => {
    const q = inputRef.current?.value.trim();
    if (!q) return;
    onFreeAsk(q);
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <section className="pane pane-answer">
      <header className="pane-head session-bar">
        {editing ? (
          <input
            className="session-select"
            autoFocus
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={() => {
              onRename(currentId, nameDraft);
              setEditing(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                onRename(currentId, nameDraft);
                setEditing(false);
              } else if (e.key === 'Escape') {
                setEditing(false);
              }
            }}
          />
        ) : (
          <select
            className="session-select"
            value={currentId}
            onChange={(e) => onSwitch(e.target.value)}
            title={t.answer.switchTitle}
          >
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
        <button
          className="btn btn-sm"
          onClick={() => {
            setNameDraft(currentName);
            setEditing(true);
          }}
          title={t.answer.renameTitle}
        >
          ✎
        </button>
        <button className="btn btn-sm" onClick={onNew} title={t.answer.newTitle}>
          ＋
        </button>
        {onOpenRagScope && <button className="btn btn-sm" onClick={onOpenRagScope}>📚 {t.rag.library}</button>}
        {onUndoDelete && <button className="btn btn-sm" onClick={onUndoDelete}>{t.answer.undoDelete}</button>}
        <button className="btn btn-sm" title={t.answer.exportText} onClick={() => {
          const session = sessions.find((s) => s.id === currentId);
          if (!session) return;
          const url = URL.createObjectURL(new Blob([sessionText(session)], { type: "text/plain;charset=utf-8" }));
          const link = document.createElement("a");
          link.href = url;
          link.download = `${session.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").slice(0, 80) || "session"}.txt`;
          link.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }}>↓ TXT</button>
        <button className="btn btn-sm" onClick={() => onDelete(currentId)} title={t.answer.deleteTitle}>
          🗑
        </button>
        <button
          className={resumeChars > 0 ? 'btn btn-sm btn-on' : 'btn btn-sm'}
          onClick={() => onPickKb('resume')}
          title={
            resumeChars > 0
              ? t.answer.resumeSetTitle(resumeName ?? '', resumeChars)
              : t.answer.resumeEmptyTitle
          }
        >
          📄{resumeChars > 0 ? resumeName ?? t.answer.resume : t.answer.resume}
        </button>
        {resumeChars > 0 && (
          <button className="btn btn-sm" onClick={() => onClearKb('resume')} title={t.answer.resumeRemoveTitle}>
            ×
          </button>
        )}
        <button
          className={jdChars > 0 ? 'btn btn-sm btn-on' : 'btn btn-sm'}
          onClick={() => onPickKb('jd')}
          title={jdChars > 0 ? t.answer.jdSetTitle(jdName ?? '', jdChars) : t.answer.jdEmptyTitle}
        >
          📋{jdChars > 0 ? jdName ?? t.answer.jd : t.answer.jd}
        </button>
        {jdChars > 0 && (
          <button className="btn btn-sm" onClick={() => onClearKb('jd')} title={t.answer.jdRemoveTitle}>
            ×
          </button>
        )}
        <span className="session-spacer" />
        <button className="btn btn-sm" onClick={onClear} title={t.answer.clearTitle}>
          {t.answer.clear}
        </button>
      </header>
      {notice && <div className="kb-notice">{notice}</div>}
      <div className="session" ref={boxRef} onScroll={onScroll}>
        {turns.length === 0 ? (
          <div className="pane-empty">
            {t.answer.empty}
            {resumeChars === 0 && t.answer.emptyKbHint}
          </div>
        ) : (
          turns.map((turn) => (
            <div key={turn.id} className={`turn turn-${turn.kind}`}>
              <div className="turn-head">
                <span className="turn-tag">{t.answer.kindTag[turn.kind]}</span>
                <span className="turn-label" title={turn.label}>
                  {turn.label}
                </span>
                {turn.status === 'streaming' ? (
                  <button className="btn btn-sm" onClick={() => onCancel(turn.id)}>
                    {t.answer.stop}
                  </button>
                ) : (
                  <button
                    className="btn btn-sm"
                    onClick={() => void navigator.clipboard.writeText(turn.text)}
                    title={t.answer.copyTitle}
                  >
                    {t.answer.copy}
                  </button>
                )}
              </div>
              {!!turn.sources?.length && <details className="answer-sources">
                <summary>{t.rag.sources(turn.sources.length)}</summary>
                <ul>{turn.sources.map((source) => <li key={source.chunkId}>
                  {source.name} — {source.relativePath}
                </li>)}</ul>
              </details>}
              {turn.status === 'error' && turn.kind !== 'vision' && <button className="btn btn-sm" disabled={!answersReady} onClick={() => onRetry(turn)}>{t.answer.retry}</button>}
              <div className="turn-body">
                {turn.status === 'error' ? (
                  <span className="answer-error">{turn.error}</span>
                ) : (
                  <>
                    {turn.text || (turn.kind === 'vision' ? t.answer.visionWaiting : t.answer.genWaiting)}
                    {turn.status === 'streaming' && <span className="cursor">▍</span>}
                  </>
                )}
              </div>
            </div>
          ))
        )}
      </div>
      {shotError && <div className="kb-notice" role="alert">{t.answer.shotFail}</div>}
      {!answersReady && <div className="kb-notice">{answersHint}</div>}
      <div className="answer-input">
        <input
          ref={inputRef}
          disabled={!answersReady}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) submit();
          }}
          placeholder={answersReady ? t.answer.freePlaceholder : answersHint}
        />
        <button
          className="btn btn-primary"
          disabled={!answersReady}
          title={answersReady ? undefined : answersHint}
          onClick={submit}
        >
          {t.answer.ask}
        </button>
        {visionReady && (
          <button
            className="btn"
            title={t.answer.shotTitle}
            onClick={async () => {
              const q = inputRef.current?.value.trim() ?? '';
              const sid = currentId;
              setShotError(false);
              let img: string | null;
              try { img = await window.mc.pickRegion(); } catch { setShotError(true); return; }
              if (!img) return; // cancelled
              if (currentIdRef.current === sid && inputRef.current?.value.trim() === q) inputRef.current.value = '';
              onShotAsk(q, img, sid);
            }}
          >
            📷
          </button>
        )}
      </div>
    </section>
  );
}
