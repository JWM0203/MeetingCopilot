import { describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ clear: vi.fn(), remove: vi.fn() }));
vi.mock('react', async () => ({ ...(await vi.importActual<typeof import('react')>('react')), useEffect: vi.fn(), useLayoutEffect: vi.fn(), useRef: () => ({ current: { contains: () => true } }), useState: (value: unknown) => [value, state.clear] }));
vi.mock('../src/i18n', () => ({ useT: () => ({ transcript: { title: 'Transcript', clear: 'Clear', empty: 'Empty' } }) }));
import { TranscriptPanel } from '../src/components/TranscriptPanel';

describe('transcript clear action', () => {
  it('dismisses local popup synchronously before clearing persisted transcript', () => {
    const onClear = vi.fn(() => expect(state.clear).toHaveBeenCalledWith(null));
    const selection = { isCollapsed: false, rangeCount: 1, toString: () => 'fragment', anchorNode: {}, focusNode: {}, getRangeAt: () => ({ startContainer: {}, endContainer: {} }), removeAllRanges: state.remove };
    vi.stubGlobal('window', { getSelection: () => selection });
    try {
      const tree = TranscriptPanel({ segments: [], answersReady: true, answersHint: '', onAsk: vi.fn(), onTranslate: vi.fn(), onClear });
      tree.props.children[0].props.children[2].props.onClick();
      expect(onClear).toHaveBeenCalledOnce();
      expect(state.remove).toHaveBeenCalledOnce();
    } finally { vi.unstubAllGlobals(); }
  });
});
