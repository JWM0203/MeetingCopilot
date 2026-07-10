import { describe, expect, it } from 'vitest';
import { parseLocalWsPort } from '../electron/funasrSidecar';

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
