import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { StatusBar } from '../src/components/StatusBar';
import { I18nProvider } from '../src/i18n';
import type { PublicSettings } from '../shared/protocol';
function render(backend: PublicSettings['asr']['backend'], ep: string) {
  return renderToStaticMarkup(createElement(I18nProvider, { lang: 'en', children: createElement(StatusBar, { backend, asr: { phase: 'ready', workerState: 'listening', ep, gpuSuspect: false }, capturing: false, onOpenHealth() {} }) }));
}
describe('active ASR configuration display', () => {
  it('names cloud streaming and does not claim GPU execution', () => {
    const html = render('cloud-realtime', 'cloud-rt');
    expect(html).toContain('Active ASR: Cloud streaming'); expect(html).toContain('API'); expect(html).not.toContain('>GPU<');
    expect(html).toContain('Local mode does not use cloud ASR keys');
  });
  it('distinguishes local sidecar from cloud transport and labels CPU honestly', () => {
    expect(render('local-realtime', 'cloud')).toContain('Active ASR: Local sidecar ASR');
    expect(render('local', 'cpu')).toContain('>CPU<');
  });
});
