import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProtectionPreference } from '../src/components/ProtectionPreference';
import { I18nProvider } from '../src/i18n';
function render(actual: boolean | null, nextLaunch: boolean, lang: 'en' | 'zh' = 'en') {
  return renderToStaticMarkup(createElement(I18nProvider, { lang, children: createElement(ProtectionPreference, { actual, nextLaunch, busy: false, onToggle() {} }) }));
}
describe('current state versus next-launch UI', () => {
  it('never presents pending ON as currently active', () => {
    const html = render(false, true);
    for (const s of ['Current protection: Off', 'Next launch: On', 'Pending next launch', 'aria-pressed="true"']) expect(html).toContain(s);
    expect(html).not.toContain('Current protection: On');
  });
  it('keeps current ON visible after requesting OFF', () => {
    const html = render(true, false);
    for (const s of ['Current protection: On', 'Next launch: Off', 'Pending next launch', 'aria-pressed="false"']) expect(html).toContain(s);
  });
  it('shows no pending flag when current and next agree', () => {
    expect(render(true, true)).not.toContain('Pending next launch');
  });
  it('does not turn unknown into a boolean claim', () => {
    expect(render(null, true)).toContain('Current protection: Unknown');
  });
  it('provides equivalent Chinese state labels', () => {
    const html = render(false, true, 'zh');
    for (const s of ['当前保护：关', '下次启动：开', '待下次启动生效']) expect(html).toContain(s);
  });
});
