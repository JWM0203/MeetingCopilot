/**
 * Where the app's read-only payload (python sidecar scripts, requirements)
 * lives at runtime.
 *
 * In development everything sits in the repo, so `app.getAppPath()` is the
 * root. Once packaged, `app.getAppPath()` points *inside* `app.asar` — a
 * virtual path no external process (python) can open and no OS API can use as
 * a working directory. Files declared as `extraResources` land next to the
 * archive instead, under `process.resourcesPath`, which is a real directory.
 *
 * Packaged layout (see electron-builder.yml `extraResources`):
 *   <resourcesPath>/tools/funasr_stream_server.py
 *   <resourcesPath>/tools/funasr_device.py
 *   <resourcesPath>/tools/moss_asr_server.py
 *   <resourcesPath>/tools/moss_asr_utils.py
 *   <resourcesPath>/requirements-funasr.txt
 *   <resourcesPath>/requirements-moss.txt
 */
import { app } from 'electron';

/**
 * Pure decision half of {@link getResourceRoot}, so the rule can be unit
 * tested without booting electron.
 */
export function resolveResourceRoot(
  isPackaged: boolean,
  resourcesPath: string,
  appPath: string,
): string {
  return isPackaged ? resourcesPath : appPath;
}

/** Root directory for shipped, non-bundled resources. Always a real directory. */
export function getResourceRoot(): string {
  return resolveResourceRoot(app.isPackaged, process.resourcesPath, app.getAppPath());
}
