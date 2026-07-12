import { describe, expect, it } from 'vitest';
import {
  parseLocalWsPort,
  pythonCandidates,
  resolvePython,
  sidecarModelArg,
  sidecarStopPlan,
} from '../electron/funasrSidecar';

describe('parseLocalWsPort', () => {
  it('extracts the port from local ws:// urls', () => {
    expect(parseLocalWsPort('ws://127.0.0.1:10097')).toBe(10097);
    expect(parseLocalWsPort('ws://localhost:10097/')).toBe(10097);
    expect(parseLocalWsPort('ws://127.0.0.1:10097/api-ws/v1/inference')).toBe(10097);
    expect(parseLocalWsPort(' ws://127.0.0.1:8080 ')).toBe(8080);
  });

  it('defaults to port 80 when omitted', () => {
    expect(parseLocalWsPort('ws://127.0.0.1')).toBe(80);
    expect(parseLocalWsPort('ws://localhost/')).toBe(80);
  });

  it('returns null for anything non-local (never spawns for remote urls)', () => {
    expect(parseLocalWsPort(undefined)).toBeNull();
    expect(parseLocalWsPort('')).toBeNull();
    expect(
      parseLocalWsPort('wss://llm-x.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference'),
    ).toBeNull();
    expect(parseLocalWsPort('ws://192.168.1.5:10097')).toBeNull();
    expect(parseLocalWsPort('wss://127.0.0.1:10097')).toBeNull(); // local sidecar is plain ws
    expect(parseLocalWsPort('https://api.xiaomimimo.com/v1')).toBeNull();
  });
});

describe('macOS sidecar portability', () => {
  it('prefers an explicit Python, then the project venv, then PATH commands', () => {
    const explicit = pythonCandidates('/app', 'darwin', '/custom/python');
    expect(explicit[0]).toBe('/custom/python');
    expect(explicit).toContain('/app/.venv/bin/python');
    expect(explicit.slice(-2)).toEqual(['python3', 'python']);

    const windows = pythonCandidates('C:\\app', 'win32');
    expect(windows).toContain('C:\\ProgramData\\miniconda3\\envs\\funasr\\python.exe');
    expect(windows.at(-1)).toBe('python');
  });

  it('reports every attempted Python when no runtime is executable', async () => {
    await expect(resolvePython(['/bad/python', 'python3'], async () => false)).rejects.toThrow(
      '/bad/python, python3',
    );
  });

  it('loads only the selected model', () => {
    expect(sidecarModelArg('fun-asr-nano')).toBe('nano');
    expect(sidecarModelArg('paraformer-zh-streaming')).toBe('paraformer');
    expect(sidecarModelArg(undefined)).toBe('nano');
  });

  it('kills the process tree with the platform-native strategy', () => {
    expect(sidecarStopPlan('win32', 42)).toEqual({
      kind: 'command',
      file: 'taskkill',
      args: ['/pid', '42', '/T', '/F'],
    });
    expect(sidecarStopPlan('darwin', 42)).toEqual({
      kind: 'signal',
      pid: -42,
      signal: 'SIGTERM',
    });
  });
});
