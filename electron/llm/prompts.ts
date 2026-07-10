/**
 * Prompt construction for meeting/interview answering (pure logic, TDD).
 * R4: (a) manual — answer THIS sentence; (b) continuous — advise on recent
 * speech; (c) free — ask over the conversation; (d) translate — translate a
 * line to Chinese. Answer language (zh/en) is a runtime prompt hook.
 *
 * v2 (2026-07-10): cache-friendly three-layer layout —
 *   stable prefix  = persona + 【简历】 + 【岗位JD】 + lang directive
 *                    (BYTE-STABLE across requests → DeepSeek prefix cache)
 *   slow state     = 【面试备忘】memo (updated every few turns)
 *   fast context   = history turns + recent transcript + this question + hint
 */
import type { ChatMessage } from './adapter';
import { classifyQuestion, isLikelyQuestion, type QuestionKind } from '../../shared/textHeuristics';

export { isLikelyQuestion, classifyQuestion };

export const MAX_CONTEXT_CHARS = 2400;

export type AnswerLang = 'chinese' | 'english';

/** The prompt hook that steers DeepSeek's reply language (R: 模式选择). */
export function langDirective(lang: AnswerLang): string {
  return lang === 'english'
    ? '- 用【英文】输出我要念的话；必要时在最后附一句极简中文备注。'
    : '- 用【中文】输出。';
}

/** teleprompter persona: the output IS what the user reads aloud, verbatim */
const PERSONA = [
  '你是我的实时面试提词器。我正在参加面试，屏幕上是面试官说话的实时转录。',
  '你输出的内容就是我接下来要照着念的话，必须遵守：',
  '- 全程用第一人称「我」，口语自然，让我可以一字不改地念出来；',
  '- 第一句先给结论或直接回应，再展开 2-3 个短要点；',
  '- 全文控制在 30-60 秒内可念完（约 150-350 字）；',
  '- 不用 Markdown 标题、编号、加粗等书面格式，分点直接换行；',
  '- 行为/经历类问题按 STAR 展开：情境→任务→行动→结果；',
  '- 技术类问题先一句话讲思路，再给关键点，必要时给复杂度或对比结论；',
  '- 只能使用【简历】里的真实经历，绝不编造简历之外的公司、项目、数字；',
  '- 没把握的问题，给出稳妥的通用说法，或一句得体的争取思考时间的话术。',
];

/** total injected background budget; keeps prompts bounded regardless of size */
export const MAX_BACKGROUND_CHARS = 8000;
/** when both slots are present the resume gets the bigger share */
export const RESUME_BUDGET = 5000;
export const JD_BUDGET = MAX_BACKGROUND_CHARS - RESUME_BUDGET;

/** resume: keep project/work-experience sections when over budget */
export const RESUME_PRIORITY =
  /(项目|经历|经验|工作|实习|成果|职责|Project|Experience|Work|Achievement)/i;
/** JD: keep responsibilities/requirements sections when over budget */
export const JD_PRIORITY =
  /(职责|要求|责任|任职|资格|技能|优先|加分|Responsibilit|Requirement|Qualification|Skill)/i;

/**
 * Deterministic budget clip that prefers paragraphs matching `priority`
 * (e.g. a resume's project experience, a JD's requirements) instead of a
 * blind head-truncation. Output order stays the original document order.
 */
export function smartClip(text: string, budget: number, priority: RegExp): string {
  const t = text.trim();
  if (t.length <= budget) return t;
  const paras = t.split(/\n{2,}/);
  const picked = new Set<number>();
  let used = 0;
  const tryTake = (i: number) => {
    if (picked.has(i)) return;
    const cost = paras[i].length + 2; // + join separator
    if (used + cost > budget) return;
    picked.add(i);
    used += cost;
  };
  for (let i = 0; i < paras.length; i++) if (priority.test(paras[i])) tryTake(i);
  for (let i = 0; i < paras.length; i++) tryTake(i);
  if (picked.size === 0) return t.slice(0, budget); // one giant paragraph
  return paras
    .map((p, i) => (picked.has(i) ? p : null))
    .filter((p): p is string => p !== null)
    .join('\n\n');
}

/**
 * The BYTE-STABLE system prompt: persona + resume + JD + language directive.
 * Same inputs MUST yield the identical string (no timestamps / randomness) —
 * the LLM prewarm request and every real request share this prefix so the
 * provider's prefix cache (DeepSeek 0.1x pricing + faster prefill) hits.
 */
export function buildStablePrefix(resume: string, jd: string, lang: AnswerLang): string {
  const parts = [...PERSONA];
  const r = resume.trim();
  const j = jd.trim();
  if (r) {
    parts.push(
      '',
      '【简历】（我的真实资料，回答只能基于此）',
      smartClip(r, j ? RESUME_BUDGET : MAX_BACKGROUND_CHARS, RESUME_PRIORITY),
      '【简历结束】',
    );
  }
  if (j) {
    parts.push(
      '',
      '【岗位JD】（本场面试针对的职位，回答向它贴合）',
      smartClip(j, r ? JD_BUDGET : MAX_BACKGROUND_CHARS, JD_PRIORITY),
      '【岗位JD结束】',
    );
  }
  parts.push('', langDirective(lang));
  return parts.join('\n');
}

/** one advisory line appended to the user message; '' when unknown */
export function questionHint(kind: QuestionKind): string {
  switch (kind) {
    case 'behavioral':
      return '（题型：行为/经历题——用 STAR 结构，讲简历里的真实经历）';
    case 'technical':
      return '（题型：技术题——先一句话思路，再关键点，必要时给复杂度）';
    case 'smalltalk':
      return '（题型：寒暄/暖场——一两句自然简短的回应即可，不用展开）';
    default:
      return '';
  }
}

// ---------- P1-5: rolling interview memo (consistency > compression) ----------

/** hard bound on the stored memo (prompt asks for ≤800, clamp defends) */
export const MAX_MEMO_CHARS = 1000;

export function clampMemo(text: string): string {
  const t = text.trim();
  return t.length > MAX_MEMO_CHARS ? t.slice(0, MAX_MEMO_CHARS) : t;
}

/**
 * Fold one finished Q&A into the rolling memo (async, off the critical path).
 * The memo keeps the interview self-consistent: what was asked, what I have
 * claimed as fact, what the interviewer cares about.
 */
export function buildMemoUpdateMessages(oldMemo: string, question: string, answer: string): ChatMessage[] {
  return [
    {
      role: 'system',
      content: [
        '你是面试会话的备忘维护器。把新一轮问答合并进备忘，输出更新后的完整备忘。',
        '备忘不超过 800 字，固定四节（无内容的节保留标题写「无」）：',
        '【已问问题】每题一行，最新在最后',
        '【我已声称的事实】数字、经历、立场——后续回答绝不能与之矛盾',
        '【面试官关注点】从提问推断',
        '【注意事项】答得不稳的点、需要圆回来的坑',
        '合并去重；超长时优先丢最旧的已问问题。只输出备忘本身，不要任何解释。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: `【当前备忘】\n${oldMemo.trim() || '（空）'}\n\n【新一轮问答】\n问：${question.trim()}\n答：${answer.trim()}`,
    },
  ];
}

// ---------- P1-6: prefix-cache prewarm ----------

/**
 * The prewarm request: system prompt byte-identical to real answer requests
 * (that's the whole point — DeepSeek caches the common token prefix), plus a
 * constant one-word user turn; max_tokens=1 upstream, reply discarded.
 */
export function buildPrewarmMessages(stablePrefix: string): ChatMessage[] {
  return [
    { role: 'system', content: stablePrefix },
    { role: 'user', content: 'ok' },
  ];
}

export interface AnswerPromptInput {
  /** the sentence to answer (segment/continuous) or the text to translate */
  question?: string;
  /** recent transcript lines, oldest first */
  recentTranscript: string[];
  mode: 'segment' | 'continuous' | 'free' | 'translate';
  /** free-form user question (mode === 'free') */
  freeQuestion?: string;
  /** reply language for segment/continuous/free (default chinese) */
  answerLang?: AnswerLang;
  /** prior Q&A turns for a coherent session (oldest first) */
  history?: ChatMessage[];
  /** resume slot (双槽资料); falls back to `background` */
  resume?: string;
  /** job-description slot (双槽资料) */
  jd?: string;
  /** legacy single-slot KB / global default — treated as resume material */
  background?: string;
  /** rolling interview memo (P1) — slow-changing block, its own message */
  memo?: string;
}

/** Keep the most recent lines within the char budget (oldest dropped first). */
export function clampTranscript(lines: string[], maxChars = MAX_CONTEXT_CHARS): string[] {
  const out: string[] = [];
  let total = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const len = lines[i].length + 1;
    if (total + len > maxChars) break;
    out.unshift(lines[i]);
    total += len;
  }
  return out;
}

/**
 * Translate a transcript line to Chinese (R: 翻译功能). Fixed target = 中文,
 * output only the translation. If the text is already Chinese the model
 * simply echoes it.
 */
export function buildTranslateMessages(text: string): ChatMessage[] {
  return [
    {
      role: 'system',
      content:
        '你是翻译引擎。把用户给的整段文本翻译成【简体中文】。只输出译文本身，不要加引号、不要解释、不要复述原文；若原文已是中文则原样返回。',
    },
    { role: 'user', content: text.trim() },
  ];
}

/** R5: screenshot Q&A — one multimodal user message for a vision model. */
export function buildVisionMessages(
  question: string,
  imageDataUrl: string,
  background?: string,
): ChatMessage[] {
  const bg = (background ?? '').trim();
  const sys =
    '你是会议助手。用户发来一张屏幕截图（通常是对方共享的 PPT/文档或一道题目）。用中文简明回答用户关于截图的问题；若是提问/题目，给出用户可以直接说的回答要点或解题思路。' +
    (bg
      ? `\n\n===== 本人资料与知识库（作答时优先采用） =====\n${bg.slice(0, MAX_BACKGROUND_CHARS)}\n===== 资料结束 =====`
      : '');
  return [
    {
      role: 'system',
      content: sys,
    },
    {
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: imageDataUrl } },
        { type: 'text', text: question.trim() || '解读这页内容的要点，并给出我应该怎么回应的建议。' },
      ],
    },
  ];
}

export function buildAnswerMessages(input: AnswerPromptInput): ChatMessage[] {
  if (input.mode === 'translate') {
    return buildTranslateMessages(input.question ?? '');
  }

  const lang: AnswerLang = input.answerLang ?? 'chinese';
  const context = clampTranscript(input.recentTranscript);
  const resume = (input.resume ?? '').trim() || (input.background ?? '').trim();
  const jd = (input.jd ?? '').trim();

  // Free "随便问": raw pass-through — NO meeting-assistant persona, so identity
  // / "which model are you" questions get the model's truthful answer. The
  // transcript + KB are offered only as optional reference.
  if (input.mode === 'free') {
    const refs: string[] = [];
    if (resume) refs.push(`【本人资料（简历）】\n${resume.slice(0, MAX_BACKGROUND_CHARS)}`);
    if (jd) refs.push(`【岗位JD】\n${jd.slice(0, MAX_BACKGROUND_CHARS)}`);
    if (context.length) refs.push(`【最近的对话转录】\n${context.join('\n')}`);
    const msgs: ChatMessage[] = [];
    if (refs.length) {
      msgs.push({ role: 'system', content: `以下资料供参考（可用可不用）：\n\n${refs.join('\n\n')}` });
    }
    msgs.push(...(input.history ?? []));
    msgs.push({ role: 'user', content: (input.freeQuestion ?? '').trim() });
    return msgs;
  }

  // segment / continuous: teleprompter with the stable prefix
  const msgs: ChatMessage[] = [{ role: 'system', content: buildStablePrefix(resume, jd, lang) }];

  const memo = (input.memo ?? '').trim();
  if (memo) {
    // slow-changing block sits BETWEEN the stable prefix and the fast history,
    // so a memo refresh only invalidates the cache from this point on
    msgs.push({ role: 'user', content: `【面试进行备忘】（此前面试内容的滚动摘要，保持前后一致）\n${memo}` });
    msgs.push({ role: 'assistant', content: '收到，我会保持一致。' });
  }

  msgs.push(...(input.history ?? []));

  const contextBlock = context.length
    ? `【最近的对话转录】\n${context.join('\n')}`
    : '【最近的对话转录】（暂无）';
  const q = (input.question ?? '').trim();
  const hint = q ? questionHint(classifyQuestion(q)) : '';
  const ask = q
    ? `面试官刚才说：\n“${q}”\n${hint ? hint + '\n' : ''}请直接给出我可以照着念的回答。`
    : '基于上面最近的转录，面试官最新的话需要我回应。请直接给出我可以照着念的回答。';

  msgs.push({ role: 'user', content: `${contextBlock}\n\n${ask}` });
  return msgs;
}
