import { describe, expect, it } from 'vitest';
import { posix, win32 } from 'path';
import { resolveResourceRoot } from '../electron/resourcePaths';
import { mossPythonCandidates, pythonCandidates } from '../electron/funasrSidecar';

// resolveResourceRoot is the pure half of getResourceRoot(); the electron
// import in that module stays inert here because we never touch `app`.
describe('resolveResourceRoot', () => {
  it('uses the repo root in development', () => {
    expect(resolveResourceRoot(false, 'C:\\ignored\\resources', 'C:\\repo\\MeetingCopilot')).toBe(
      'C:\\repo\\MeetingCopilot',
    );
  });

  it('uses resourcesPath when packaged (never the app.asar path)', () => {
    const appPath = 'C:\\Program Files\\MeetingCopilot\\resources\\app.asar';
    const resourcesPath = 'C:\\Program Files\\MeetingCopilot\\resources';
    expect(resolveResourceRoot(true, resourcesPath, appPath)).toBe(resourcesPath);
    expect(resolveResourceRoot(true, resourcesPath, appPath)).not.toContain('app.asar');
  });

  // the composed script path must match electron-builder.yml `extraResources`
  // (tools -> tools); joins are platform-pinned so the assertions hold on any
  // host running the suite
  it('resolves the packaged sidecar scripts outside the asar archive', () => {
    const winRoot = resolveResourceRoot(
      true,
      'C:\\Program Files\\MeetingCopilot\\resources',
      'C:\\Program Files\\MeetingCopilot\\resources\\app.asar',
    );
    expect(win32.join(winRoot, 'tools', 'funasr_stream_server.py')).toBe(
      'C:\\Program Files\\MeetingCopilot\\resources\\tools\\funasr_stream_server.py',
    );

    const macRoot = resolveResourceRoot(
      true,
      '/Applications/MeetingCopilot.app/Contents/Resources',
      '/Applications/MeetingCopilot.app/Contents/Resources/app.asar',
    );
    expect(posix.join(macRoot, 'tools', 'moss_asr_server.py')).toBe(
      '/Applications/MeetingCopilot.app/Contents/Resources/tools/moss_asr_server.py',
    );
  });
});

describe('python discovery under a packaged resource root', () => {
  const packagedRoot = 'C:\\Program Files\\MeetingCopilot\\resources';

  it('still offers the conda default and PATH fallbacks when no .venv ships', () => {
    const candidates = pythonCandidates(packagedRoot, 'win32', undefined);
    // the .venv entry is a dev convenience that simply will not exist here;
    // resolvePython only probes, so it must not shadow the later candidates
    expect(candidates[0]).toBe('C:\\Program Files\\MeetingCopilot\\resources\\.venv\\Scripts\\python.exe');
    expect(candidates).toContain('C:\\ProgramData\\miniconda3\\envs\\funasr\\python.exe');
    expect(candidates.at(-1)).toBe('python');
  });

  it('keeps the MOSS environment separate when packaged', () => {
    const candidates = mossPythonCandidates(packagedRoot, 'win32', undefined);
    expect(candidates).toContain('C:\\ProgramData\\miniconda3\\envs\\moss-asr\\python.exe');
    expect(candidates).not.toContain('C:\\ProgramData\\miniconda3\\envs\\funasr\\python.exe');
  });
});
