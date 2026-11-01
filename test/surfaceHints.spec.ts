import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { hintProps, hintSurface, installSurfaceHints } from '../src/surfaceHints';

class Target extends EventTarget {}
function fire(target: EventTarget, type: string, values: object = {}) {
  const event = new Event(type);
  for (const [key, value] of Object.entries(values)) Object.defineProperty(event, key, { value });
  target.dispatchEvent(event);
}
function setup() {
  const doc = new Target();
  const host = Object.assign(new Target(), { innerWidth: 800, innerHeight: 600 });
  const element = {
    dataset: { hint: '让 AI 帮我回答这句' }, isConnected: true,
    getBoundingClientRect: () => ({ left: 790, bottom: 590 }),
    contains: (other: unknown) => other === element,
    closest: () => element,
  };
  const show = vi.fn();
  const dispose = installSurfaceHints(doc as unknown as Document, host as unknown as Window, show);
  return { doc, host, element, show, dispose };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
describe('same-surface accessible hints', () => {
  it('never creates native title attributes and preserves accessible help without replacing the visible name', () => {
    expect(hintProps('help')).toEqual({ 'data-hint': 'help', 'aria-description': 'help' });
    expect(hintProps(undefined)).toEqual({});
    const transcript = readFileSync(join(__dirname, '..', 'src/components/TranscriptPanel.tsx'), 'utf8');
    expect(transcript).not.toMatch(/\btitle=/);
    expect(transcript).toContain('hintProps(answersReady ? t.transcript.answerTitle : answersHint)');
  });
  it('shows hovered hints after a delay inside viewport bounds', () => {
    const { doc, element, show, dispose } = setup();
    fire(doc, 'pointerover', { target: element });
    vi.advanceTimersByTime(449);
    expect(show).not.toHaveBeenCalledWith(expect.objectContaining({ text: element.dataset.hint }));
    vi.advanceTimersByTime(1);
    expect(show).toHaveBeenLastCalledWith({ text: element.dataset.hint, x: 512, y: 504 });
    dispose();
  });
  it('supports keyboard focus and Escape without moving focus', () => {
    const { doc, element, show, dispose } = setup();
    fire(doc, 'focusin', { target: element }); vi.runAllTimers();
    expect(show).toHaveBeenLastCalledWith(expect.objectContaining({ text: element.dataset.hint }));
    fire(doc, 'keydown', { key: 'Escape' });
    expect(show).toHaveBeenLastCalledWith(null);
    dispose();
  });
  it.each(['pointerout', 'focusout', 'pointerdown', 'scroll'])('cancels pending hint on %s', (name) => {
    const { doc, element, show, dispose } = setup();
    fire(doc, 'pointerover', { target: element });
    fire(doc, name); vi.runAllTimers();
    expect(show).toHaveBeenLastCalledWith(null);
    expect(show).not.toHaveBeenCalledWith(expect.objectContaining({ text: element.dataset.hint }));
    dispose();
  });
  it('dismisses on app blur and cleans listeners/timers on unmount', () => {
    const { doc, host, element, show, dispose } = setup();
    fire(doc, 'focusin', { target: element }); vi.runAllTimers();
    fire(host, 'blur'); expect(show).toHaveBeenLastCalledWith(null);
    dispose(); show.mockClear();
    fire(doc, 'pointerover', { target: element }); vi.runAllTimers();
    expect(show).not.toHaveBeenCalled();
  });
});

it('puts modal hints in the dialog top layer without opening or focusing anything', () => {
  const body = {} as HTMLElement;
  const modal = {} as HTMLElement;
  const querySelector = vi.fn().mockReturnValue(modal);
  const doc = { body, querySelector } as unknown as Document;
  expect(hintSurface(doc)).toBe(modal);
  expect(querySelector).toHaveBeenCalledWith('dialog[open]');
  querySelector.mockReturnValue(null);
  expect(hintSurface(doc)).toBe(body);
});
it('keyboard focus replaces a pending hover delay immediately', () => {
  const { doc, element, show, dispose } = setup();
  fire(doc, 'pointerover', { target: element });
  fire(doc, 'focusin', { target: element });
  vi.advanceTimersByTime(0);
  expect(show).toHaveBeenLastCalledWith(expect.objectContaining({ text: element.dataset.hint }));
  dispose();
});
