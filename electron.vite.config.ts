import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { existsSync, readdirSync, rmdirSync, unlinkSync } from 'fs';
import { join, resolve } from 'path';

/**
 * Vite already asks to empty out/renderer before each build, but it does so
 * with fs.rmSync(dir, { recursive: true }) — and on Windows + Node >= 24 that
 * call silently succeeds while deleting nothing when the path contains
 * non-ASCII characters (this project is developed under a CJK directory name).
 * The result is invisible: out/renderer/assets accumulates the content-hashed
 * bundle of every build ever run, and electron-builder packs the lot. The first
 * packaged build here carried 39 dead index-*.{js,css} files, 16 MB, inside
 * app.asar.
 *
 * unlink/rmdir are unaffected by the bug, so walk the tree ourselves. This is a
 * no-op on a clean checkout and cheap enough to always run.
 */
function removeDirDeep(dir: string): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) removeDirDeep(full);
    else unlinkSync(full);
  }
  rmdirSync(dir);
}

/** buildStart runs before Vite copies publicDir and writes the bundle. */
const cleanRendererOut = {
  name: 'mc:clean-renderer-out',
  apply: 'build' as const,
  buildStart(): void {
    removeDirDeep(resolve(__dirname, 'out/renderer'));
  },
};

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': resolve(__dirname, 'shared') } },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'electron/main.ts'),
          asrWorker: resolve(__dirname, 'electron/asr/worker.ts'),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'electron/preload.ts') },
      },
    },
  },
  renderer: {
    root: 'src',
    publicDir: resolve(__dirname, 'src/public'),
    plugins: [react(), cleanRendererOut],
    resolve: { alias: { '@shared': resolve(__dirname, 'shared') } },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/index.html') },
      },
    },
  },
});
