import { describe, expect, it } from 'vitest';
import { redactSecrets } from '../shared/redact';

const MARK = '…[redacted]';

describe('redactSecrets', () => {
  it('masks an OpenAI-style key but keeps its first 4 characters', () => {
    const out = redactSecrets('key sk-abcd1234efgh5678 used');
    expect(out).toBe(`key sk-a${MARK} used`);
    expect(out).not.toContain('1234efgh5678');
  });

  it('masks a Google AI Studio key', () => {
    const out = redactSecrets('AIzaSyA1b2C3d4E5f6G7h8I9j0');
    expect(out).toBe(`AIza${MARK}`);
  });

  it('masks a bare Bearer token', () => {
    expect(redactSecrets('Bearer abcdefgh12345678')).toBe(`Bearer abcd${MARK}`);
  });

  it('masks an Authorization header and keeps the scheme word', () => {
    const out = redactSecrets('Authorization: Bearer sk-livekey0987654321');
    expect(out).toBe(`Authorization: Bearer sk-l${MARK}`);
    expect(out).not.toContain('0987654321');
  });

  it('masks api-key / api_key / apiKey fields in any punctuation style', () => {
    expect(redactSecrets('api-key: 12345678abcd')).toBe(`api-key: 1234${MARK}`);
    expect(redactSecrets('api_key=zyxw98765432')).toBe(`api_key=zyxw${MARK}`);
    expect(redactSecrets('{"apiKey":"qwer12345678"}')).toBe(`{"apiKey":"qwer${MARK}"}`);
  });

  it('keeps the interior text around a secret intact', () => {
    const out = redactSecrets(
      'cloud ASR HTTP 401: {"error":{"message":"invalid key sk-zzzz11112222","type":"auth"}}',
    );
    expect(out).toContain('cloud ASR HTTP 401');
    expect(out).toContain('"type":"auth"');
    expect(out).toContain(`sk-z${MARK}`);
    expect(out).not.toContain('11112222');
  });

  it('masks several secrets of different shapes in one line', () => {
    const out = redactSecrets('a sk-11112222333 b AIzaAAAABBBBCCCC c Bearer ddddeeeeffff');
    expect(out).toBe(`a sk-1${MARK} b AIza${MARK} c Bearer dddd${MARK}`);
  });

  it('is a no-op on text without secrets', () => {
    expect(redactSecrets('local ASR engine failed to start: port 10097 busy')).toBe(
      'local ASR engine failed to start: port 10097 busy',
    );
  });

  it('leaves short non-secret tokens like sk-1 alone', () => {
    expect(redactSecrets('sk-12 is too short to be a key')).toBe('sk-12 is too short to be a key');
  });

  it('is idempotent — redacting an already redacted line changes nothing', () => {
    const once = redactSecrets('Authorization: Bearer sk-abcd1234efgh, api_key=zz');
    expect(redactSecrets(once)).toBe(once);
  });

  it('returns an empty string for non-string input', () => {
    expect(redactSecrets(undefined as unknown as string)).toBe('');
    expect(redactSecrets('')).toBe('');
  });
});
