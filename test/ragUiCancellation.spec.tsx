import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicSettings } from '../shared/protocol';

const stateWrites = vi.hoisted(() => [] as unknown[]);
vi.mock('react', async () => ({
  ...await vi.importActual('react'),
  useEffect: () => undefined,
  useState: (initial: unknown) => [initial, (value: unknown) => stateWrites.push(value)],
  useRef: (current: unknown) => ({ current }),
}));
vi.mock('../src/i18n', () => ({ useT: () => ({ rag: {
  phases: {}, counts: () => '', failed: 'failed',
} }) }));
import { KnowledgeBaseSettings } from '../src/components/KnowledgeBaseSettings';

type Element = { type?: string; props?: Record<string, any> };
function elements(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(elements);
  if (!value || typeof value !== 'object') return [];
  const node = value as Element;
  return [node, ...elements(node.props?.children)];
}

beforeEach(() => { stateWrites.length = 0; vi.unstubAllGlobals(); });
describe('knowledge rebuild interruption', () => {
  for (const rejects of [false, true]) it(`allows OFF during a scan and ignores its late ${rejects ? 'error' : 'result'}`, async () => {
    let resolve!: (value: unknown) => void;
    let reject!: (reason: unknown) => void;
    const scan = new Promise((yes, no) => { resolve = yes; reject = no; });
    const disabled = { phase: 'disabled', enabled: false, fileCount: 0, chunkCount: 0, failedCount: 0 };
    const settings = { rag: { enabled: true, rootPath: '/documents' } } as PublicSettings;
    const setSettings = vi.fn(async () => ({ ...settings, rag: { enabled: false } }));
    vi.stubGlobal('window', { mc: {
      scanRag: () => scan, setSettings,
      getRagStatus: async () => disabled, onRagStatus() {}, chooseRagRoot() {},
    } });
    const nodes = elements(KnowledgeBaseSettings({ settings, onChanged() {} }));
    const buttons = nodes.filter((node) => node.type === 'button');
    buttons[1].props!.onClick();
    const checkbox = nodes.find((node) => node.type === 'input')!;
    expect(checkbox.props!.disabled).toBe(false);
    checkbox.props!.onChange({ target: { checked: false } });
    await Promise.resolve();
    await Promise.resolve();
    expect(setSettings).toHaveBeenCalledWith({ rag: { enabled: false } });
    expect(stateWrites).toContain(disabled);
    const late = { ...disabled, phase: 'ready', enabled: true };
    if (rejects) reject(new Error('cancelled')); else resolve(late);
    await Promise.resolve();
    await Promise.resolve();
    expect(stateWrites).not.toContain(late);
    expect(stateWrites).not.toContain('failed');
  });
});
