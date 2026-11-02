import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
function declarations(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...css.matchAll(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]+)\\}`, 'g'))].map(m => m[1]).join('\n');
}
describe('production glass UI preservation contracts', () => {
  it('retains panel-only user opacity and opaque text containers', () => {
    expect(css).toContain('--app-alpha: 0.55');
    expect(css).toContain('rgba(37, 40, 48, var(--app-alpha))');
    expect(css).toContain('rgba(244, 245, 248, var(--app-alpha))');
    for (const selector of ['body', '.app', '.bubble', '.bubble-live', '.turn', '.turn-body']) {
      expect(declarations(selector)).not.toMatch(/(?:^|[;\n])\s*opacity\s*:/);
    }
  });
  it('keeps original native drag regions and fixed selection popup', () => {
    expect(declarations('.titlebar')).toContain('-webkit-app-region: drag');
    expect(declarations('.titlebar-actions')).toContain('-webkit-app-region: no-drag');
    expect(declarations('.sel-popup')).toContain('position: fixed');
    expect(declarations('.sel-popup')).toContain('z-index: 50');
  });
  it('does not restore colored left rails or hide direct bubble actions', () => {
    expect(declarations('.turn')).not.toContain('border-left');
    expect(declarations('.bubble-btns')).toContain('display: flex');
    expect(declarations('.bubble-btns')).not.toContain('display: none');
    expect(css).not.toContain('#2ea05c');
  });
  it('keeps keyboard focus and narrow-window wrapping without network assets', () => {
    expect(css).toContain(':focus-visible'); expect(css).toContain('prefers-reduced-motion');
    expect(declarations('.titlebar-actions')).toContain('flex-wrap: wrap');
    expect(css).not.toMatch(/@import|url\(\s*['"]?https?:/);
  });
});
