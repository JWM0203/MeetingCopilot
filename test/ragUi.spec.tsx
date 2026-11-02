import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { KnowledgeBaseSettings } from '../src/components/KnowledgeBaseSettings';
import { KnowledgeScopeDialog } from '../src/components/KnowledgeScopeDialog';
import { I18nProvider } from '../src/i18n';
import type { PublicSettings } from '../shared/protocol';

const settings = { rag: { enabled: false } } as PublicSettings;
function render(child: ReturnType<typeof createElement>) {
  return renderToStaticMarkup(createElement(I18nProvider, { lang: 'en', children: child }));
}
afterEach(() => vi.unstubAllGlobals());
describe('opt-in knowledge UI', () => {
  it('keeps knowledge off and discloses download, local resources, provider transmission and costs', () => {
    vi.stubGlobal('window', { mc: { getRagStatus() {}, onRagStatus() {}, chooseRagRoot() {}, scanRag() {}, setSettings() {} } });
    const html = render(createElement(KnowledgeBaseSettings, { settings, onChanged() {} }));
    expect(html).not.toContain('checked=""');
    for (const text of ['Off by default', 'embedding model', 'CPU and disk', 'configured LLM provider', 'input tokens', 'charges', 'symbolic links']) expect(html).toContain(text);
    expect(html).toContain('take effect immediately');
  });
  it('shows an honest unavailable notice without enabling actions on an old bridge', () => {
    vi.stubGlobal('window', { mc: {} });
    const html = render(createElement(KnowledgeBaseSettings, { settings, onChanged() {} }));
    expect(html).toContain('unavailable in this build');
    expect((html.match(/disabled=""/g) ?? []).length).toBe(3);
  });
  it('prevents an empty selected-document scope from silently becoming all documents', () => {
    const html = render(createElement(KnowledgeScopeDialog, { scope: { enabled: true, includePaths: ['missing.md'] }, documents: [], onSave() {}, onClose() {} }));
    expect(html).toContain('Select at least one document');
    expect(html).toContain('disabled=""');
    expect(html).toContain('No indexed documents yet');
  });
});
