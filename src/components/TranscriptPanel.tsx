import { useEffect, useRef, useState } from 'react';
import type { TranscriptSegment } from '../../shared/transcript';
import { useT } from '../i18n';

interface SelPopup {
  text: string;
  x: number;
  y: number;
}

/**
 * Scrollable, persistent transcript (R3). Dual-channel: 对方 (system audio,
 * left) vs 我 (mic, right). Each bubble is one VAD sentence; a long question
 * may span several bubbles, so besides per-bubble ⚡答, the user can drag-SELECT
 * exact text across bubbles → a popup answers precisely that selection.
 * Translation is INLINE (原文/译文 对照) and off-session, so it never pollutes
 * the answer context / wastes tokens.
 */
export function TranscriptPanel({
  segments,
  partials,
  onAsk,
  onTranslate,
  onClear,
}: {
  segments: TranscriptSegment[];
  partials?: { them?: string; me?: string };
  onAsk: (text: string) => void;
  onTranslate: (seg: TranscriptSegment) => void;
  onClear: () => void;
}) {
  const t = useT();
  const boxRef = useRef<HTMLDivElement>(null);
  const [stick, setStick] = useState(true);
  const [sel, setSel] = useState<SelPopup | null>(null);

  useEffect(() => {
    if (stick && boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight;
  }, [segments, stick]);

  const onScroll = () => {
    const el = boxRef.current;
    if (!el) return;
    setStick(el.scrollHeight - el.scrollTop - el.clientHeight < 48);
    setSel(null);
  };

  const captureSelection = () => {
    const s = window.getSelection();
    const text = s?.toString().trim() ?? '';
    if (!text || !s || s.rangeCount === 0) {
      setSel(null);
      return;
    }
    const box = boxRef.current;
    const anchor = s.anchorNode;
    if (!box || !anchor || !box.contains(anchor.nodeType === 3 ? anchor.parentNode : anchor)) return;
    const rect = s.getRangeAt(0).getBoundingClientRect();
    setSel({ text, x: rect.left + rect.width / 2, y: rect.top });
  };

  const answerSel = () => {
    if (sel) onAsk(sel.text);
    window.getSelection()?.removeAllRanges();
    setSel(null);
  };

  return (
    <section className="pane pane-transcript">
      <header className="pane-head">
        <span className="pane-title">{t.transcript.title}</span>
        <span className="pane-hint">{t.transcript.hint}</span>
        <button className="btn btn-sm" onClick={onClear} title={t.transcript.clearTitle}>
          {t.transcript.clear}
        </button>
      </header>
      <div className="transcript" ref={boxRef} onScroll={onScroll} onMouseUp={captureSelection}>
        {segments.length === 0 ? (
          <div className="pane-empty">{t.transcript.empty}</div>
        ) : (
          segments.map((s) => {
            const me = s.speaker === 'me';
            return (
              <div
                key={s.id}
                className={`bubble ${me ? 'bubble-me' : 'bubble-them'}`}
                title={t.transcript.bubbleTitle}
                onClick={() => {
                  if (!window.getSelection()?.toString().trim()) {
                    void navigator.clipboard.writeText(s.text);
                  }
                }}
              >
                <div className="bubble-role">{me ? t.transcript.me : t.transcript.them}</div>
                <div className="bubble-text">{s.text}</div>
                {(s.translation || s.translating) && (
                  <div className="bubble-trans">{s.translating ? t.transcript.translating : s.translation}</div>
                )}
                <div className="bubble-meta">
                  {new Date(s.endTs).toLocaleTimeString(t.locale, { hour12: false })}
                  {s.lang
                    ? ` · ${s.lang === 'chinese' ? t.transcript.langZh : s.lang === 'english' ? t.transcript.langEn : s.lang}`
                    : ''}
                  {s.e2eMs !== undefined ? ` · ${(s.e2eMs / 1000).toFixed(2)}s` : ''}
                </div>
                <div className="bubble-btns">
                  <button
                    className="bubble-ask"
                    title={t.transcript.translateTitle}
                    onClick={(e) => {
                      e.stopPropagation();
                      onTranslate(s);
                    }}
                  >
                    {t.transcript.translateBtn}
                  </button>
                  {!me && (
                    <button
                      className="bubble-ask"
                      title={t.transcript.answerTitle}
                      onClick={(e) => {
                        e.stopPropagation();
                        onAsk(s.text);
                      }}
                    >
                      {t.transcript.answerBtn}
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
        {partials?.them && (
          <div className="bubble bubble-them bubble-live">
            <div className="bubble-role">{`${t.transcript.them} · ${t.transcript.live}`}</div>
            <div className="bubble-text">{partials.them}</div>
          </div>
        )}
        {partials?.me && (
          <div className="bubble bubble-me bubble-live">
            <div className="bubble-role">{`${t.transcript.me} · ${t.transcript.live}`}</div>
            <div className="bubble-text">{partials.me}</div>
          </div>
        )}
        {!stick && (
          <button
            className="jump-bottom"
            onClick={() => {
              setStick(true);
              if (boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight;
            }}
          >
            {t.transcript.jumpLatest}
          </button>
        )}
      </div>
      {sel && (
        <div
          className="sel-popup"
          style={{ left: sel.x, top: sel.y }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <button className="btn btn-sm btn-primary" onClick={answerSel}>
            {t.transcript.answerSelection}
          </button>
        </div>
      )}
    </section>
  );
}
