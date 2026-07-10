import { useEffect, useRef, useState } from 'react';
import type { TranscriptSegment } from '../../shared/transcript';

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
        <span className="pane-title">📝 转录</span>
        <span className="pane-hint">划选精准回答 · 译=对照</span>
        <button className="btn btn-sm" onClick={onClear} title="清空本会话转录">
          清空
        </button>
      </header>
      <div className="transcript" ref={boxRef} onScroll={onScroll} onMouseUp={captureSelection}>
        {segments.length === 0 ? (
          <div className="pane-empty">点击「▶ 开始」采集系统声音，对方说的每句话会出现在这里。</div>
        ) : (
          segments.map((s) => {
            const me = s.speaker === 'me';
            return (
              <div
                key={s.id}
                className={`bubble ${me ? 'bubble-me' : 'bubble-them'}`}
                title="点击复制（或划选文字精准回答）"
                onClick={() => {
                  if (!window.getSelection()?.toString().trim()) {
                    void navigator.clipboard.writeText(s.text);
                  }
                }}
              >
                <div className="bubble-role">{me ? '我' : '对方'}</div>
                <div className="bubble-text">{s.text}</div>
                {(s.translation || s.translating) && (
                  <div className="bubble-trans">{s.translating ? '翻译中…' : s.translation}</div>
                )}
                <div className="bubble-meta">
                  {new Date(s.endTs).toLocaleTimeString('zh-CN', { hour12: false })}
                  {s.lang ? ` · ${s.lang === 'chinese' ? '中' : s.lang === 'english' ? 'EN' : s.lang}` : ''}
                  {s.e2eMs !== undefined ? ` · ${(s.e2eMs / 1000).toFixed(2)}s` : ''}
                </div>
                <div className="bubble-btns">
                  <button
                    className="bubble-ask"
                    title="翻译成中文（原文/译文对照，不进对话上下文）"
                    onClick={(e) => {
                      e.stopPropagation();
                      onTranslate(s);
                    }}
                  >
                    译
                  </button>
                  {!me && (
                    <button
                      className="bubble-ask"
                      title="让 AI 帮我回答这句"
                      onClick={(e) => {
                        e.stopPropagation();
                        onAsk(s.text);
                      }}
                    >
                      ⚡答
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
        {partials?.them && (
          <div className="bubble bubble-them bubble-live">
            <div className="bubble-role">对方 · 实时</div>
            <div className="bubble-text">{partials.them}</div>
          </div>
        )}
        {partials?.me && (
          <div className="bubble bubble-me bubble-live">
            <div className="bubble-role">我 · 实时</div>
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
            ↓ 回到最新
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
            ⚡回答选中
          </button>
        </div>
      )}
    </section>
  );
}
