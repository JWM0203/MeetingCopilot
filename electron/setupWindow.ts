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
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

/** logged so the packaged smoke test can prove first-run gating still works */
export const SETUP_WINDOW_MARKER = '[setup] window created';
/** logged once the wizard renderer completes its first IPC call (main.ts) */
export const SETUP_READY_MARKER = '[setup] wizard ready';
/** logged after an MC_SETUP_SHOT capture (visual-QA tooling greps for it) */
export const SETUP_SHOT_MARKER = '[setup] screenshot';

/** MC_SETUP_STEP=1..5 opens the wizard directly on that step (visual QA) */
function forcedStep(): string | null {
  const raw = process.env.MC_SETUP_STEP;
  if (!raw) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? String(n) : null;
}

/**
 * Visual-QA hook, env-gated exactly like the MC_E2E_* hooks in main.ts:
 * MC_SETUP_SHOT=<dir> writes a PNG of the rendered wizard into <dir> once the
 * page has painted. Never runs unless the variable is set.
 */
function captureIfRequested(win: BrowserWindow, step: string | null): void {
  const dir = process.env.MC_SETUP_SHOT;
  if (!dir) return;
  win.webContents.on('did-finish-load', () => {
    // one frame is not enough: fonts, the settings round-trip and the first
    // React render all land after load
    setTimeout(() => {
      void win.webContents
        .capturePage()
        .then((image) => {
          mkdirSync(dir, { recursive: true });
          const file = join(dir, `setup-step-${step ?? '1'}.png`);
          writeFileSync(file, image.toPNG());
          console.log(`${SETUP_SHOT_MARKER} ${file}`);
        })
        .catch((e: Error) => console.warn(`${SETUP_SHOT_MARKER} failed: ${e.message}`));
    }, 1500);
  });
}

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

  const step = forcedStep();
  captureIfRequested(win, step);

  if (process.env.ELECTRON_RENDERER_URL) {
    const query = step ? `?step=${step}` : '';
    void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/setup.html${query}`);
  } else {
    void win.loadFile(
      join(__dirname, '../renderer/setup.html'),
      step ? { query: { step } } : undefined,
    );
  }

  console.log(SETUP_WINDOW_MARKER);
  return win;
}
