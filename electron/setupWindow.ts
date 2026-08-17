/**
 * First-run setup window (the onboarding wizard).
 *
 * Deliberately the opposite of the main overlay: a normal, framed, taskbar-
 * visible window that is NOT always-on-top and NOT content-protected — the
 * user must be able to follow it in a screen share while someone helps them
 * paste an API key.
 *
 * It keeps the main window's navigation hardening though: window.open denied,
 * will-navigate prevented. (The region-selection overlay in main.ts sets
 * neither — that is a precedent to fix, not to copy.)
 */
import { BrowserWindow } from 'electron';
import { join } from 'path';

/** logged so the packaged smoke test can prove first-run gating still works */
export const SETUP_WINDOW_MARKER = '[setup] window created';
/** logged once the wizard renderer completes its first IPC call (main.ts) */
export const SETUP_READY_MARKER = '[setup] wizard ready';

export function createSetupWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 860,
    height: 680,
    minWidth: 760,
    minHeight: 600,
    frame: true,
    transparent: false,
    alwaysOnTop: false,
    skipTaskbar: false,
    resizable: true,
    center: true,
    show: false, // shown on ready-to-show, so it never flashes unpainted
    webPreferences: {
      // minimal surface: window.mcSetup only, NOT the full window.mc api
      preload: join(__dirname, '../preload/setup.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // the wizard must stay visible in screen shares / remote help sessions
  win.setContentProtection(false);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.once('ready-to-show', () => win.show());

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/setup.html`);
  } else {
    void win.loadFile(join(__dirname, '../renderer/setup.html'));
  }

  console.log(SETUP_WINDOW_MARKER);
  return win;
}
