/**
 * System-tray icon + context menu (Phase 4, spec §A).
 *
 * The menu MODEL lives in shared/trayMenu.ts (pure, unit-tested); this file is
 * only the Electron plumbing: load an icon that survives packaging, build the
 * native menu, and hand every click back to the main process as a
 * {@link TrayCommand}.
 *
 * Two rules the rest of the app depends on:
 *  - creation NEVER throws. A headless CI box, a broken shell notification
 *    area or a missing icon must degrade to "no tray", not to a crash on boot;
 *    every entry point returns a boolean / no-ops instead.
 *  - the menu is rebuilt from the live state on every relevant change (window
 *    shown/hidden, capture started/stopped, UI language switched), because
 *    Electron menus are immutable snapshots once assigned.
 */
import { Menu, Tray, nativeImage, type MenuItemConstructorOptions } from 'electron';
import { join } from 'path';
import {
  buildTrayMenu,
  trayTooltip,
  type TrayCommand,
  type TrayMenuLabels,
  type TrayMenuState,
} from '../shared/trayMenu';

/** logged once the tray exists; QA/E2E greps for it */
export const TRAY_READY_MARKER = '[tray] created';

/**
 * Where the icon lives at runtime. `resourceRoot` is the repo root in dev and
 * `resources/` in a packaged build (electron/resourcePaths.ts), and the
 * electron-builder `extraResources` entry mirrors the repo-relative path, so
 * this one join works on both sides with no branch.
 *
 * macOS gets the black+alpha template variant so the system can recolour it for
 * light/dark menu bars; Windows and Linux get the colour icon.
 */
export function trayIconPath(resourceRoot: string, platform: string = process.platform): string {
  const file = platform === 'darwin' ? 'trayTemplate.png' : 'tray.png';
  return join(resourceRoot, 'resources', 'tray', file);
}

export interface TrayOptions {
  iconPath: string;
  /** read fresh on every rebuild, so a language switch needs no re-wiring */
  labels: () => TrayMenuLabels;
  state: () => TrayMenuState;
  onCommand: (command: TrayCommand) => void;
  /** left click on the icon (Windows: also fired twice by a double click) */
  onClick: () => void;
  onDoubleClick: () => void;
}

export class AppTray {
  private tray: Tray | null = null;
  private options: TrayOptions | null = null;

  get exists(): boolean {
    return this.tray !== null;
  }

  /** @returns false when this machine cannot show a tray icon (never throws) */
  create(options: TrayOptions): boolean {
    if (this.tray) return true;
    try {
      const image = nativeImage.createFromPath(options.iconPath);
      if (image.isEmpty()) {
        console.warn(`[tray] icon missing or unreadable: ${options.iconPath}`);
        return false;
      }
      if (process.platform === 'darwin') image.setTemplateImage(true);
      const tray = new Tray(image);
      tray.on('click', () => options.onClick());
      tray.on('double-click', () => options.onDoubleClick());
      this.tray = tray;
      this.options = options;
      this.refresh();
      console.log(TRAY_READY_MARKER);
      return true;
    } catch (e) {
      // headless CI, a locked-down shell, an exotic Linux DE — all survivable
      console.warn('[tray] could not be created:', (e as Error).message);
      this.tray = null;
      this.options = null;
      return false;
    }
  }

  /** rebuild the context menu + tooltip from the current state and language */
  refresh(): void {
    const tray = this.tray;
    const options = this.options;
    if (!tray || !options || tray.isDestroyed()) return;
    const labels = options.labels();
    const state = options.state();
    const template: MenuItemConstructorOptions[] = buildTrayMenu(state, labels).map((entry) => {
      if (entry.kind === 'separator') return { type: 'separator' };
      if (entry.kind === 'label') return { label: entry.label, enabled: false };
      const command = entry.id as TrayCommand;
      return { label: entry.label, click: () => options.onCommand(command) };
    });
    try {
      tray.setContextMenu(Menu.buildFromTemplate(template));
      tray.setToolTip(trayTooltip(state, labels));
    } catch (e) {
      console.warn('[tray] menu rebuild failed:', (e as Error).message);
    }
  }

  /**
   * One-shot "the app is still running" balloon after the window is hidden for
   * the first time. Windows only: `displayBalloon` is a no-op elsewhere, and
   * macOS users can see the menu-bar icon anyway.
   */
  notifyHidden(title: string, content: string): void {
    if (process.platform !== 'win32') return;
    const tray = this.tray;
    if (!tray || tray.isDestroyed()) return;
    try {
      tray.displayBalloon({ title, content });
    } catch (e) {
      console.warn('[tray] balloon failed:', (e as Error).message);
    }
  }

  destroy(): void {
    const tray = this.tray;
    this.tray = null;
    this.options = null;
    if (!tray || tray.isDestroyed()) return;
    try {
      tray.destroy();
    } catch (e) {
      console.warn('[tray] destroy failed:', (e as Error).message);
    }
  }
}
