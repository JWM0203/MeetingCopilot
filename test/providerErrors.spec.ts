import { describe, expect, it } from 'vitest';
import {
  PROVIDER_TEST_HINTS,
  PROVIDER_TEST_MESSAGES,
  describeError,
  extractRequestId,
  isRetryable,
  normalizeProviderError,
  type ProviderErrorContext,
} from '../electron/providerErrors';
import type { ProviderTestCode } from '../shared/protocol';

const LLM: ProviderErrorContext = { capability: 'text-llm', providerId: 'deepseek' };
const RT: ProviderErrorContext = { capability: 'asr-realtime', providerId: 'aliyun-dashscope-cn' };
const SEG: ProviderErrorContext = { capability: 'asr-segment', providerId: 'mimo' };
const VIS: ProviderErrorContext = { capability: 'vision', providerId: 'gemini' };

/** the transports throw plain Errors with the status folded into the text */
const httpError = (prefix: string, status: number, body: string) =>
  new Error(`${prefix} HTTP ${status}: ${body}`);

/** undici shape: `fetch failed` wrapping a connect error in `cause` */
const fetchError = (code: string, detail: string) => {
  const cause = Object.assign(new Error(detail), { code });
  return Object.assign(new TypeError('fetch failed'), { cause });
};

describe('normalizeProviderError — HTTP status table', () => {
  const cases: [number, string, ProviderTestCode][] = [
    [401, '{"error":{"message":"Authentication Fails"}}', 'INVALID_KEY'],
    [402, '{"error":{"message":"Insufficient Balance"}}', 'INSUFFICIENT_BALANCE'],
    [403, '{"error":{"message":"Access denied to this workspace"}}', 'PERMISSION_DENIED'],
    [404, '{"error":{"message":"Model Not Exist"}}', 'MODEL_NOT_FOUND'],
    [429, '{"error":{"message":"Rate limit reached"}}', 'RATE_LIMITED'],
    [500, '{"error":{"message":"internal error"}}', 'PROVIDER_ERROR'],
    [502, 'bad gateway', 'PROVIDER_ERROR'],
    [503, 'upstream unavailable', 'PROVIDER_ERROR'],
  ];

  for (const [status, body, code] of cases) {
    it(`maps HTTP ${status} to ${code}`, () => {
      const r = normalizeProviderError(httpError('LLM', status, body), LLM);
      expect(r.code).toBe(code);
      expect(r.messageZh).toBe(PROVIDER_TEST_MESSAGES[code].zh);
      expect(r.messageEn).toBe(PROVIDER_TEST_MESSAGES[code].en);
      expect(r.retryable).toBe(isRetryable(code));
    });
  }

  it('reads the status from a structured error object too', () => {
    const err = Object.assign(new Error('provider said no'), { status: 429 });
    expect(normalizeProviderError(err, SEG).code).toBe('RATE_LIMITED');
  });

  it('leaves an unexplained 400 as UNKNOWN_ERROR', () => {
    expect(normalizeProviderError(httpError('LLM', 400, '{"detail":"?"}'), LLM).code).toBe(
      'UNKNOWN_ERROR',
    );
  });
});

describe('normalizeProviderError — transport failures', () => {
  const cases: [string, unknown, ProviderTestCode][] = [
    ['ENOTFOUND', fetchError('ENOTFOUND', 'getaddrinfo ENOTFOUND api.deepseek.com'), 'DNS_ERROR'],
    ['EAI_AGAIN', fetchError('EAI_AGAIN', 'getaddrinfo EAI_AGAIN api.deepseek.com'), 'DNS_ERROR'],
    [
      'ECONNREFUSED',
      fetchError('ECONNREFUSED', 'connect ECONNREFUSED 127.0.0.1:443'),
      'NETWORK_UNREACHABLE',
    ],
    [
      'EHOSTUNREACH',
      fetchError('EHOSTUNREACH', 'connect EHOSTUNREACH 10.0.0.1:443'),
      'NETWORK_UNREACHABLE',
    ],
    [
      'ENETUNREACH',
      fetchError('ENETUNREACH', 'connect ENETUNREACH 10.0.0.1:443'),
      'NETWORK_UNREACHABLE',
    ],
    ['ETIMEDOUT', fetchError('ETIMEDOUT', 'connect ETIMEDOUT 1.2.3.4:443'), 'TIMEOUT'],
    [
      'TLS cert string',
      fetchError('CERT_HAS_EXPIRED', 'certificate has expired'),
      'TLS_ERROR',
    ],
    [
      'self-signed cert',
      new Error('unable to verify the first certificate'),
      'TLS_ERROR',
    ],
    [
      'proxy tunnel',
      new Error('tunneling socket could not be established, statusCode=407'),
      'PROXY_ERROR',
    ],
    [
      'electron proxy errno',
      Object.assign(new Error('net::ERR_PROXY_CONNECTION_FAILED'), {
        code: 'ERR_PROXY_CONNECTION_FAILED',
      }),
      'PROXY_ERROR',
    ],
  ];

  for (const [label, err, code] of cases) {
    it(`maps ${label} to ${code}`, () => {
      expect(normalizeProviderError(err, VIS).code).toBe(code);
    });
  }

  it('maps an aborted fetch (our 12 s budget) to TIMEOUT', () => {
    const err = Object.assign(new Error('This operation was aborted'), { name: 'AbortError' });
    expect(normalizeProviderError(err, LLM).code).toBe('TIMEOUT');
  });

  it('maps a WebSocket handshake timeout to TIMEOUT', () => {
    expect(normalizeProviderError(new Error('ws error: Opening handshake has timed out'), RT).code).toBe(
      'TIMEOUT',
    );
  });
});

describe('normalizeProviderError — DashScope task-failed frames', () => {
  // the realtime engine surfaces `${error_code}: ${error_message}`
  const cases: [string, ProviderTestCode][] = [
    ['InvalidApiKey: Invalid API-key provided.', 'INVALID_KEY'],
    ['Arrearage: Access denied, please make sure your account is in good standing.', 'INSUFFICIENT_BALANCE'],
    ['AccessDenied.Unpurchased: The model has not been activated for this workspace.', 'PERMISSION_DENIED'],
    ['Throttling.RateQuota: Requests rate limit exceeded, please try again later.', 'RATE_LIMITED'],
    ['ModelNotFound: model not exist.', 'MODEL_NOT_FOUND'],
    ['InvalidParameter: model is invalid for this task', 'MODEL_NOT_FOUND'],
    ['InternalError: SystemError, please try again.', 'PROVIDER_ERROR'],
    ['CLIENT_ERROR: task failed for an unspecified reason', 'PROVIDER_ERROR'],
    ['SomethingBrandNew: nobody has seen this before', 'UNKNOWN_ERROR'],
  ];

  for (const [message, code] of cases) {
    it(`maps "${message.split(':')[0]}" to ${code}`, () => {
      expect(normalizeProviderError(new Error(message), RT).code).toBe(code);
    });
  }

  it('reads a rejected WebSocket upgrade as an auth failure', () => {
    // `ws` reports a refused upgrade as "Unexpected server response: <status>"
    expect(normalizeProviderError(new Error('ws error: Unexpected server response: 401'), RT).code).toBe(
      'INVALID_KEY',
    );
    expect(normalizeProviderError(new Error('ws error: Unexpected server response: 403'), RT).code).toBe(
      'PERMISSION_DENIED',
    );
  });
});

describe('normalizeProviderError — safety', () => {
  it('never lets a key reach the caller-visible facts', () => {
    const err = httpError('LLM', 401, '{"sent":"Authorization: Bearer sk-supersecret12345"}');
    const facts = describeError(err);
    expect(facts.text).not.toContain('supersecret12345');
    expect(facts.text).toContain('…[redacted]');
    const r = normalizeProviderError(err, LLM);
    expect(JSON.stringify(r)).not.toContain('supersecret12345');
  });

  it('does not echo raw provider text into the user-facing message', () => {
    const r = normalizeProviderError(httpError('LLM', 500, 'stack trace at /home/user/app.js'), LLM);
    expect(r.messageZh).toBe(PROVIDER_TEST_MESSAGES.PROVIDER_ERROR.zh);
    expect(r.messageEn).not.toContain('/home/user');
  });

  it('tolerates non-Error throws', () => {
    expect(normalizeProviderError('boom', LLM).code).toBe('UNKNOWN_ERROR');
    expect(normalizeProviderError(undefined, LLM).code).toBe('UNKNOWN_ERROR');
    expect(normalizeProviderError({ status: 401 }, LLM).code).toBe('INVALID_KEY');
  });
});

describe('provider request id', () => {
  it('is pulled out of a JSON body when present', () => {
    expect(extractRequestId('{"request_id":"7b1c2d3e-aaaa-bbbb"}')).toBe('7b1c2d3e-aaaa-bbbb');
    expect(normalizeProviderError(new Error('HTTP 500 {"request_id":"abc123456"}'), LLM).providerRequestId).toBe(
      'abc123456',
    );
  });

  it('is undefined when the provider volunteered nothing', () => {
    expect(extractRequestId('plain failure')).toBeUndefined();
  });
});

describe('message dictionaries', () => {
  const codes: ProviderTestCode[] = [
    'OK',
    'INVALID_KEY',
    'PERMISSION_DENIED',
    'INSUFFICIENT_BALANCE',
    'RATE_LIMITED',
    'MODEL_NOT_FOUND',
    'REGION_MISMATCH',
    'NETWORK_UNREACHABLE',
    'DNS_ERROR',
    'TLS_ERROR',
    'PROXY_ERROR',
    'TIMEOUT',
    'PROVIDER_ERROR',
    'UNKNOWN_ERROR',
  ];

  it('covers all 14 codes in both languages, with a hint each', () => {
    for (const code of codes) {
      expect(PROVIDER_TEST_MESSAGES[code].zh.length).toBeGreaterThan(0);
      expect(PROVIDER_TEST_MESSAGES[code].en.length).toBeGreaterThan(0);
      expect(PROVIDER_TEST_HINTS[code].zh.length).toBeGreaterThan(0);
      expect(PROVIDER_TEST_HINTS[code].en.length).toBeGreaterThan(0);
    }
    expect(Object.keys(PROVIDER_TEST_MESSAGES)).toHaveLength(codes.length);
  });

  it('uses full-width punctuation only in the Chinese copy', () => {
    for (const code of codes) {
      expect(PROVIDER_TEST_MESSAGES[code].zh).not.toMatch(/[,;?!]/);
    }
  });

  it('marks exactly the recoverable codes as retryable', () => {
    expect(codes.filter(isRetryable).sort()).toEqual(
      ['DNS_ERROR', 'NETWORK_UNREACHABLE', 'PROVIDER_ERROR', 'RATE_LIMITED', 'TIMEOUT'].sort(),
    );
  });
});
