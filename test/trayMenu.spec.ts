import { describe, expect, it } from 'vitest';
import { existsSync } from 'fs';
import { join } from 'path';
import {
  buildTrayMenu,
  isRendererCommand,
  trayTooltip,
  type TrayMenuLabels,
  type TrayMenuState,
} from '../shared/trayMenu';
import { trayIconPath } from '../electron/tray';
import { mainStrings } from '../electron/uiStrings';

const labels: TrayMenuLabels = {
  brand: 'MeetingCopilot',
  showWindow: 'show',
  hideWindow: 'hide',
  startCapture: 'start',
  stopCapture: 'stop',
  newSession: 'new',
  settings: 'settings',
  serviceStatus: 'status',
  help: 'help',
  checkUpdates: 'updates',
  quit: 'quit',
  capturing: 'transcribing',
};

const state = (patch: Partial<TrayMenuState> = {}): TrayMenuState => ({
  windowVisible: true,
  capturing: false,
  ...patch,
});

describe('tray menu model', () => {
  it('offers every documented entry, in order', () => {
    const ids = buildTrayMenu(state(), labels)
      .filter((e) => e.kind === 'command')
      .map((e) => e.id);
    expect(ids).toEqual([
      'toggle-window',
      'toggle-capture',
      'new-session',
      'open-settings',
      'open-health',
      'open-help',
      'check-updates',
      'quit',
    ]);
  });

  it('opens with a disabled brand label so the menu identifies the app', () => {
    const [first] = buildTrayMenu(state(), labels);
    expect(first).toEqual({ id: 'brand', label: 'MeetingCopilot', kind: 'label' });
  });

  it('flips the window entry with visibility', () => {
    const labelFor = (visible: boolean) =>
      buildTrayMenu(state({ windowVisible: visible }), labels).find(
        (e) => e.id === 'toggle-window',
      )?.label;
    expect(labelFor(true)).toBe('hide');
    expect(labelFor(false)).toBe('show');
  });

  it('flips the capture entry with the capture state', () => {
    const labelFor = (capturing: boolean) =>
      buildTrayMenu(state({ capturing }), labels).find((e) => e.id === 'toggle-capture')?.label;
    expect(labelFor(false)).toBe('start');
    expect(labelFor(true)).toBe('stop');
  });

  it('separates the groups instead of running eleven entries together', () => {
    const kinds = buildTrayMenu(state(), labels).map((e) => e.kind);
    expect(kinds.filter((k) => k === 'separator')).toHaveLength(4);
    // never a leading or trailing divider
    expect(kinds[0]).toBe('label');
    expect(kinds.at(-1)).toBe('command');
  });

  it('shows the capture state in the tooltip', () => {
    expect(trayTooltip(state(), labels)).toBe('MeetingCopilot');
    expect(trayTooltip(state({ capturing: true }), labels)).toBe('MeetingCopilot · transcribing');
  });

  it('routes only renderer-owned actions to the renderer', () => {
    expect(isRendererCommand('toggle-capture')).toBe(true);
    expect(isRendererCommand('new-session')).toBe(true);
    expect(isRendererCommand('open-settings')).toBe(true);
    expect(isRendererCommand('open-health')).toBe(true);
    expect(isRendererCommand('open-help')).toBe(true);
    // main owns these: the renderer cannot show a window or quit the app
    expect(isRendererCommand('toggle-window')).toBe(false);
    expect(isRendererCommand('check-updates')).toBe(false);
    expect(isRendererCommand('quit')).toBe(false);
  });
});

describe('tray strings and icon', () => {
  it('has a distinct zh and en label set (MainDict enforces both exist)', () => {
    const zh = mainStrings('zh', 'en').tray;
    const en = mainStrings('en', 'zh').tray;
    expect(zh.startCapture).toBe('开始转写');
    expect(en.startCapture).toBe('Start transcription');
    expect(zh.quit).not.toBe(en.quit);
  });

  it('ships an icon for the platform, and it exists in the repo', () => {
    expect(trayIconPath('/root', 'win32')).toBe(join('/root', 'resources', 'tray', 'tray.png'));
    // macOS gets the black+alpha template so the menu bar can recolour it
    expect(trayIconPath('/root', 'darwin')).toBe(
      join('/root', 'resources', 'tray', 'trayTemplate.png'),
    );
    const repoRoot = join(__dirname, '..');
    for (const platform of ['win32', 'darwin'] as const) {
      expect(existsSync(trayIconPath(repoRoot, platform))).toBe(true);
    }
    // Electron picks the @2x variant on HiDPI displays by filename convention
    expect(existsSync(join(repoRoot, 'resources', 'tray', 'tray@2x.png'))).toBe(true);
    expect(existsSync(join(repoRoot, 'resources', 'tray', 'trayTemplate@2x.png'))).toBe(true);
  });
});
