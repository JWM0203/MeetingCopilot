/**
 * System-tray menu model (Phase 4, spec §A).
 *
 * The tray is a reliability fix, not sugar: the main window is frameless,
 * `skipTaskbar: true` and content-protected, so if the global show/hide hotkey
 * fails to register (another app already owns the accelerator) a hidden window
 * is unreachable. The tray is the guaranteed way back in — and the guaranteed
 * way out.
 *
 * This module is the pure half: which entries the menu has, in which order,
 * and which label each one shows for the current state. No electron, no React,
 * so the derivation is unit-testable and the main process is left with nothing
 * but the Menu.buildFromTemplate plumbing (electron/tray.ts).
 */

/** every action the tray menu can trigger */
export type TrayCommand =
  | 'toggle-window'
  | 'toggle-capture'
  | 'new-session'
  | 'open-settings'
  | 'open-health'
  | 'open-help'
  | 'check-updates'
  | 'quit';

/**
 * The subset the MAIN process cannot perform on its own: capture, sessions and
 * every panel live in the renderer, so these are forwarded over
 * `IPC.trayCommand` after the window has been made visible.
 */
export type TrayRendererCommand = Extract<
  TrayCommand,
  'toggle-capture' | 'new-session' | 'open-settings' | 'open-health' | 'open-help'
>;

const RENDERER_COMMANDS: readonly TrayCommand[] = [
  'toggle-capture',
  'new-session',
  'open-settings',
  'open-health',
  'open-help',
];

/** true when the command has to be handled by the renderer, not by main */
export function isRendererCommand(command: TrayCommand): command is TrayRendererCommand {
  return RENDERER_COMMANDS.includes(command);
}

/** localized tray strings (electron/uiStrings.ts owns the zh/en dictionaries) */
export interface TrayMenuLabels {
  brand: string;
  showWindow: string;
  hideWindow: string;
  startCapture: string;
  stopCapture: string;
  newSession: string;
  settings: string;
  serviceStatus: string;
  help: string;
  checkUpdates: string;
  quit: string;
  /** tooltip suffix while transcription is running */
  capturing: string;
}

/** what the menu has to reflect right now */
export interface TrayMenuState {
  windowVisible: boolean;
  capturing: boolean;
}

export interface TrayMenuEntry {
  id: TrayCommand | 'brand' | 'separator';
  /** '' for separators */
  label: string;
  kind: 'command' | 'label' | 'separator';
}

const SEPARATOR: TrayMenuEntry = { id: 'separator', label: '', kind: 'separator' };

/**
 * The menu, top to bottom. 显示/隐藏窗口 and 开始/停止转写 are single toggle
 * entries whose label follows the live state — two entries where one of them is
 * always a no-op reads as a bug to users.
 */
export function buildTrayMenu(state: TrayMenuState, labels: TrayMenuLabels): TrayMenuEntry[] {
  return [
    { id: 'brand', label: labels.brand, kind: 'label' },
    SEPARATOR,
    {
      id: 'toggle-window',
      label: state.windowVisible ? labels.hideWindow : labels.showWindow,
      kind: 'command',
    },
    {
      id: 'toggle-capture',
      label: state.capturing ? labels.stopCapture : labels.startCapture,
      kind: 'command',
    },
    { id: 'new-session', label: labels.newSession, kind: 'command' },
    SEPARATOR,
    { id: 'open-settings', label: labels.settings, kind: 'command' },
    { id: 'open-health', label: labels.serviceStatus, kind: 'command' },
    { id: 'open-help', label: labels.help, kind: 'command' },
    SEPARATOR,
    { id: 'check-updates', label: labels.checkUpdates, kind: 'command' },
    SEPARATOR,
    { id: 'quit', label: labels.quit, kind: 'command' },
  ];
}

/** hover text on the tray icon; the only always-visible status the app has */
export function trayTooltip(state: TrayMenuState, labels: TrayMenuLabels): string {
  return state.capturing ? `${labels.brand} · ${labels.capturing}` : labels.brand;
}
