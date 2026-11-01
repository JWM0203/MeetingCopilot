import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AnswerSession, type AnswerTurn } from '../src/components/AnswerSession';
import { I18nProvider } from '../src/i18n';

function render(turn: AnswerTurn, lang: 'en' | 'zh' = 'en') {
  const noop = () => {};
  return renderToStaticMarkup(createElement(I18nProvider, { lang, children: createElement(AnswerSession, {
    sessions: [], currentId: 'fixture', turns: [turn], resumeChars: 0, jdChars: 0,
    visionReady: false, answersReady: true, answersHint: '', onSwitch: noop, onNew: noop,
    onDelete: noop, onRename: noop, onPickKb: noop, onClearKb: noop, onCancel: noop,
    onRetry: noop, onClear: noop, onFreeAsk: noop, onShotAsk: noop,
  }) }));
}
const empty: AnswerTurn = { id: 'fixture-turn', kind: 'free', label: 'Question', text: '', status: 'done' };
describe('completed or cancelled answer display', () => {
  it.each(['free', 'vision'] as const)('never claims an empty completed %s turn is still generating', (kind) => {
    const html = render({ ...empty, kind });
    expect(html).toContain('Generation ended without an answer.');
    expect(html).not.toMatch(/Generating…|Analyzing…|class="cursor"/);
  });
  it('localizes the ended state', () => {
    expect(render(empty, 'zh')).toContain('本次生成已结束，未生成回答。');
  });
  it('retains partial output when generation was stopped', () => {
    const html = render({ ...empty, text: 'Partial answer' });
    expect(html).toContain('Partial answer');
    expect(html).not.toContain('Generation ended without an answer.');
  });
  it.each(['free', 'vision'] as const)('retains the waiting indicator only for active %s turns', (kind) => {
    const html = render({ ...empty, kind, status: 'streaming' });
    expect(html).toContain(kind === 'vision' ? 'Analyzing…' : 'Generating…');
    expect(html).not.toContain('Generation ended without an answer.');
  });
});
