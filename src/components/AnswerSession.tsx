import { useEffect, useRef, useState } from 'react';
import type { KbSlot, StoredSession } from '../../shared/protocol';

export type TurnKind = 'segment' | 'continuous' | 'free' | 'translate' | 'vision';

export interface AnswerTurn {
  id: string;
  kind: TurnKind;
  label: string;
  text: string;
  status: 'streaming' | 'done' | 'error';
  error?: string;
}

const KIND_TAG: Record<TurnKind, string> = {
  segment: '答',
  continuous: '持续',
  free: '问',
  translate: '译',
  vision: '截图',
};

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
  onSwitch,
  onNew,
  onDelete,
  onRename,
  onPickKb,
  onClearKb,
  onCancel,
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
  onSwitch: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onPickKb: (slot: KbSlot) => void;
  onClearKb: (slot: KbSlot) => void;
  onCancel: (id: string) => void;
  onClear: () => void;
  onFreeAsk: (question: string) => void;
  onShotAsk: (question: string, imageDataUrl?: string) => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const inputRef = useRef<HTMLInputElement>(null);
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
            title="切换会话"
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
          title="重命名当前会话"
        >
          ✎
        </button>
        <button className="btn btn-sm" onClick={onNew} title="新建会话">
          ＋
        </button>
        <button className="btn btn-sm" onClick={() => onDelete(currentId)} title="删除当前会话">
          🗑
        </button>
        <button
          className={resumeChars > 0 ? 'btn btn-sm btn-on' : 'btn btn-sm'}
          onClick={() => onPickKb('resume')}
          title={
            resumeChars > 0
              ? `简历：${resumeName}（${resumeChars}字）点击更换（.md/.txt/.docx/.pdf）`
              : '导入我的简历（.md/.txt/.docx/.pdf）'
          }
        >
          📄{resumeChars > 0 ? resumeName ?? '简历' : '简历'}
        </button>
        {resumeChars > 0 && (
          <button className="btn btn-sm" onClick={() => onClearKb('resume')} title="移除简历">
            ×
          </button>
        )}
        <button
          className={jdChars > 0 ? 'btn btn-sm btn-on' : 'btn btn-sm'}
          onClick={() => onPickKb('jd')}
          title={
            jdChars > 0
              ? `岗位JD：${jdName}（${jdChars}字）点击更换（.md/.txt/.docx/.pdf）`
              : '导入岗位JD（.md/.txt/.docx/.pdf）'
          }
        >
          📋{jdChars > 0 ? jdName ?? 'JD' : 'JD'}
        </button>
        {jdChars > 0 && (
          <button className="btn btn-sm" onClick={() => onClearKb('jd')} title="移除岗位JD">
            ×
          </button>
        )}
        <span className="session-spacer" />
        <button className="btn btn-sm" onClick={onClear} title="清空本会话对话">
          清空
        </button>
      </header>
      {notice && <div className="kb-notice">{notice}</div>}
      <div className="session" ref={boxRef} onScroll={onScroll}>
        {turns.length === 0 ? (
          <div className="pane-empty">
            点转录里对方那句的「⚡答」让 AI 帮你回答；或在下方随便问。答案会在这里逐条累积。
            {resumeChars === 0 && '\n\n提示：点上方「📄简历」「📋JD」导入资料（支持 docx/pdf），回答会更贴合你。'}
          </div>
        ) : (
          turns.map((t) => (
            <div key={t.id} className={`turn turn-${t.kind}`}>
              <div className="turn-head">
                <span className="turn-tag">{KIND_TAG[t.kind]}</span>
                <span className="turn-label" title={t.label}>
                  {t.label}
                </span>
                {t.status === 'streaming' ? (
                  <button className="btn btn-sm" onClick={() => onCancel(t.id)}>
                    停
                  </button>
                ) : (
                  <button
                    className="btn btn-sm"
                    onClick={() => void navigator.clipboard.writeText(t.text)}
                    title="复制"
                  >
                    复制
                  </button>
                )}
              </div>
              <div className="turn-body">
                {t.status === 'error' ? (
                  <span className="answer-error">{t.error}</span>
                ) : (
                  <>
                    {t.text ||
                      (t.kind === 'vision'
                        ? '识别中…（视觉模型较慢，约 5-10 秒）'
                        : '生成中…（深度/思考模型会先思考几秒）')}
                    {t.status === 'streaming' && <span className="cursor">▍</span>}
                  </>
                )}
              </div>
            </div>
          ))
        )}
      </div>
      <div className="answer-input">
        <input
          ref={inputRef}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) submit();
          }}
          placeholder="随便问：基于当前对话向 AI 提问…"
        />
        <button className="btn btn-primary" onClick={submit}>
          问
        </button>
        {visionReady && (
          <button
            className="btn"
            title="截图框选问视觉模型（拉框选区域，输入框内容作为问题）"
            onClick={async () => {
              const q = inputRef.current?.value.trim() ?? '';
              const img = await window.mc.pickRegion();
              if (!img) return; // cancelled
              if (inputRef.current) inputRef.current.value = '';
              onShotAsk(q, img);
            }}
          >
            📷
          </button>
        )}
      </div>
    </section>
  );
}
