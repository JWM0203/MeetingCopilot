/**
 * One mapper turns EVERY provider failure into one of the 14
 * {@link ProviderTestCode} values plus a ready-to-show zh/en sentence.
 *
 * Why it lives here and not in a UI dictionary: the messages travel INSIDE
 * `ProviderTestResult` over IPC, so the renderer never has to look at a raw
 * provider error — which is also what keeps API keys, Authorization headers
 * and provider stack traces out of the UI.
 *
 * The whole module is pure: no electron, no fetch, no clock. Everything it
 * needs is squeezed out of the thrown value first ({@link describeError}) and
 * then matched by an ORDERED rule table, so every rule is unit-testable.
 */
import type { ProviderCapability, ProviderId } from '../shared/providerCatalog';
import type { ProviderTestCode } from '../shared/protocol';
import { redactSecrets } from '../shared/redact';

export interface ProviderErrorContext {
  capability: ProviderCapability;
  providerId: ProviderId;
}

export interface NormalizedProviderError {
  code: ProviderTestCode;
  messageZh: string;
  messageEn: string;
  retryable: boolean;
  providerRequestId?: string;
}

/** the two halves of a user-facing message */
interface Bilingual {
  zh: string;
  en: string;
}

/**
 * The sentence shown to the user for each outcome (spec §C). Deliberately free
 * of provider jargon: the raw provider text is a detail, not the headline.
 */
export const PROVIDER_TEST_MESSAGES: Record<ProviderTestCode, Bilingual> = {
  OK: { zh: '连接成功', en: 'Connection successful' },
  INVALID_KEY: {
    zh: 'API Key 无效、已删除或粘贴不完整',
    en: 'The API key is invalid, deleted, or was pasted incompletely',
  },
  PERMISSION_DENIED: {
    zh: '当前 Key 没有访问该模型或业务空间的权限',
    en: 'This key cannot access the selected model or workspace',
  },
  INSUFFICIENT_BALANCE: {
    zh: '账号余额、免费额度或套餐额度不足',
    en: 'The account balance, free tier, or plan quota is exhausted',
  },
  RATE_LIMITED: {
    zh: '请求过于频繁或达到当前额度限制',
    en: 'Too many requests, or the current quota limit was reached',
  },
  MODEL_NOT_FOUND: {
    zh: '当前模型不可用或模型名已变化',
    en: 'The selected model is unavailable or has been renamed',
  },
  REGION_MISMATCH: {
    zh: 'Key、地区与服务地址不匹配',
    en: 'The key, the region, and the service endpoint do not match',
  },
  NETWORK_UNREACHABLE: {
    zh: '无法连接服务商，请检查网络',
    en: 'Could not reach the provider — check your network',
  },
  DNS_ERROR: { zh: '域名解析失败', en: 'DNS resolution failed' },
  TLS_ERROR: { zh: '安全连接失败', en: 'The secure connection failed' },
  PROXY_ERROR: { zh: '代理连接失败', en: 'The proxy connection failed' },
  TIMEOUT: { zh: '服务连接超时', en: 'The connection to the service timed out' },
  PROVIDER_ERROR: { zh: '服务商暂时异常', en: 'The provider is temporarily failing' },
  UNKNOWN_ERROR: { zh: '未知错误', en: 'Unknown error' },
};

/**
 * The single next action worth offering. Exported next to the messages so the
 * Phase 3b UI has one source for both halves instead of inventing its own.
 */
export const PROVIDER_TEST_HINTS: Record<ProviderTestCode, Bilingual> = {
  OK: { zh: '可以继续下一步', en: 'You can continue' },
  INVALID_KEY: { zh: '重新填写 Key，或打开服务商的 Key 页面', en: 'Re-enter the key, or open the provider key page' },
  PERMISSION_DENIED: { zh: '检查账号权限，或打开官方教程', en: 'Check the account permissions, or open the official guide' },
  INSUFFICIENT_BALANCE: { zh: '打开服务商控制台充值', en: 'Open the provider console and top up' },
  RATE_LIMITED: { zh: '稍后重试', en: 'Retry in a moment' },
  MODEL_NOT_FOUND: { zh: '恢复推荐配置', en: 'Restore the recommended configuration' },
  REGION_MISMATCH: { zh: '切换地区后重试', en: 'Switch region and retry' },
  NETWORK_UNREACHABLE: { zh: '检查网络连接', en: 'Check the network connection' },
  DNS_ERROR: { zh: '检查 DNS 或代理设置', en: 'Check the DNS or proxy settings' },
  TLS_ERROR: { zh: '检查系统时间、证书和代理', en: 'Check the system clock, certificates, and proxy' },
  PROXY_ERROR: { zh: '检查代理地址', en: 'Check the proxy address' },
  TIMEOUT: { zh: '重试，或切换网络', en: 'Retry, or switch network' },
  PROVIDER_ERROR: { zh: '稍后重试', en: 'Retry later' },
  UNKNOWN_ERROR: { zh: '复制诊断信息后反馈', en: 'Copy the diagnostics and report it' },
};

/** codes whose cause may disappear on its own (spec §C). */
const RETRYABLE: ReadonlySet<ProviderTestCode> = new Set<ProviderTestCode>([
  'RATE_LIMITED',
  'TIMEOUT',
  'NETWORK_UNREACHABLE',
  'DNS_ERROR',
  'PROVIDER_ERROR',
]);

export function isRetryable(code: ProviderTestCode): boolean {
  return RETRYABLE.has(code);
}

// ---------- error shape extraction ----------

/** everything the rules are allowed to look at */
export interface ErrorFacts {
  /** `err.name` ('AbortError', 'TimeoutError', …) */
  name: string;
  /** node/electron errno-ish code ('ENOTFOUND', 'ERR_TLS_CERT_ALTNAME_INVALID', …) */
  errno: string;
  /** HTTP status, when one could be recovered */
  status?: number;
  /** the full text, ALREADY redacted */
  text: string;
}

/**
 * Recover the HTTP status the transports fold into their message text:
 *  - `LLM HTTP 401: {...}` / `cloud ASR HTTP 429: …` / `Vision HTTP 402: …`
 *  - `ws error: Unexpected server response: 401` — how the `ws` package
 *    reports a REJECTED WebSocket upgrade, which is exactly how DashScope
 *    answers a bad key on the realtime endpoint.
 */
const STATUS_IN_MESSAGE: readonly RegExp[] = [
  /\bHTTP\s+(\d{3})\b/i,
  /\b(?:unexpected server response|status(?:\s*code)?)\s*[:=]?\s*(\d{3})\b/i,
];

/** provider request ids worth surfacing in the collapsible advanced detail */
const REQUEST_ID =
  /["']?(?:request[_-]?id|x-request-id|requestid|trace[_-]?id)["']?\s*[:=]\s*["']?([A-Za-z0-9._-]{6,64})/i;

function readString(source: Record<string, unknown>, key: string): string {
  const v = source[key];
  return typeof v === 'string' ? v : '';
}

function readStatus(source: Record<string, unknown>): number | undefined {
  for (const key of ['status', 'statusCode', 'httpStatus']) {
    const v = source[key];
    if (typeof v === 'number' && v >= 100 && v <= 599) return v;
  }
  return undefined;
}

/**
 * Flatten an unknown thrown value into the facts the rules match on. Walks one
 * level of `cause` because undici wraps connect failures
 * (`TypeError: fetch failed` with `cause: Error{code:'ENOTFOUND'}`).
 *
 * Everything textual is redacted HERE, once — no rule and no message may ever
 * see a raw key.
 */
export function describeError(err: unknown): ErrorFacts {
  const parts: string[] = [];
  let name = '';
  let errno = '';
  let status: number | undefined;

  let current: unknown = err;
  for (let depth = 0; depth < 4 && current != null; depth++) {
    if (typeof current === 'string') {
      parts.push(current);
      break;
    }
    if (typeof current !== 'object') {
      parts.push(String(current));
      break;
    }
    const obj = current as Record<string, unknown>;
    name ||= readString(obj, 'name');
    errno ||= readString(obj, 'code') || readString(obj, 'errno');
    status ??= readStatus(obj);
    const message = readString(obj, 'message');
    if (message) parts.push(message);
    const body = readString(obj, 'body') || readString(obj, 'responseText');
    if (body) parts.push(body);
    current = obj.cause;
  }

  const text = redactSecrets(parts.join(' | '));
  if (status === undefined) {
    for (const re of STATUS_IN_MESSAGE) {
      const m = re.exec(text);
      if (m) {
        status = Number(m[1]);
        break;
      }
    }
  }
  return { name, errno, status, text };
}

/** provider request id, when the payload volunteered one */
export function extractRequestId(text: string): string | undefined {
  const m = REQUEST_ID.exec(text);
  return m ? m[1] : undefined;
}

// ---------- ordered rule table ----------

interface Rule {
  code: ProviderTestCode;
  match(f: ErrorFacts): boolean;
}

const has = (f: ErrorFacts, re: RegExp): boolean => re.test(f.text) || re.test(f.errno);

/**
 * Ordered, first-match-wins.
 *
 * Transport failures come first: they never carry an HTTP status, and an
 * `ECONNREFUSED` buried in a proxy message must not be read as "the provider
 * said no". HTTP status is checked next because it is the provider's own
 * verdict; free-text patterns only run when there is no status (DashScope
 * `task-failed` frames arrive over an already-established WebSocket, so they
 * have codes but no status).
 */
export const PROVIDER_ERROR_RULES: readonly Rule[] = [
  // ---- transport ----
  {
    code: 'PROXY_ERROR',
    match: (f) =>
      has(f, /ERR_PROXY_CONNECTION_FAILED|ERR_TUNNEL_CONNECTION_FAILED|ERR_UNEXPECTED_PROXY_AUTH/i) ||
      /tunneling socket could not be established|proxy (connect|connection) (failed|refused)|failed to connect to proxy/i.test(
        f.text,
      ),
  },
  {
    code: 'TLS_ERROR',
    match: (f) =>
      has(
        f,
        /\bCERT_[A-Z_]+|UNABLE_TO_VERIFY_LEAF_SIGNATURE|SELF_SIGNED_CERT|DEPTH_ZERO_SELF_SIGNED_CERT|ERR_TLS|ERR_SSL|EPROTO/i,
      ) ||
      /certificate has expired|self.signed certificate|unable to verify the first certificate|ssl routines|tls handshake/i.test(
        f.text,
      ),
  },
  {
    code: 'DNS_ERROR',
    match: (f) => has(f, /\bENOTFOUND\b|\bEAI_AGAIN\b|ERR_NAME_NOT_RESOLVED/i) || /getaddrinfo/i.test(f.text),
  },
  {
    code: 'NETWORK_UNREACHABLE',
    match: (f) =>
      has(f, /\bECONNREFUSED\b|\bEHOSTUNREACH\b|\bENETUNREACH\b|\bENETDOWN\b|ERR_CONNECTION_REFUSED|ERR_INTERNET_DISCONNECTED/i),
  },
  {
    code: 'TIMEOUT',
    match: (f) =>
      f.name === 'AbortError' ||
      f.name === 'TimeoutError' ||
      has(f, /\bETIMEDOUT\b|\bESOCKETTIMEDOUT\b|ERR_CONNECTION_TIMED_OUT|ERR_TIMED_OUT|ABORT_ERR/i) ||
      /\btimed out\b|\btimeout\b|操作被中止|aborted (due to|because of) (a )?timeout|the operation was aborted/i.test(
        f.text,
      ),
  },

  // ---- the provider answered with an HTTP status ----
  { code: 'INVALID_KEY', match: (f) => f.status === 401 },
  { code: 'INSUFFICIENT_BALANCE', match: (f) => f.status === 402 },
  { code: 'PERMISSION_DENIED', match: (f) => f.status === 403 },
  { code: 'MODEL_NOT_FOUND', match: (f) => f.status === 404 },
  { code: 'RATE_LIMITED', match: (f) => f.status === 429 },
  { code: 'PROVIDER_ERROR', match: (f) => f.status !== undefined && f.status >= 500 },

  // ---- free text (WebSocket task-failed frames, 400-with-a-reason bodies) ----
  {
    code: 'INVALID_KEY',
    match: (f) =>
      /InvalidApiKey|invalid[_\s-]?api[_\s-]?key|invalid api-key|unauthorized|authentication (failed|error)|api key (is )?(invalid|expired|revoked|deleted)|无效的?\s*api\s*key|密钥(无效|错误)/i.test(
        f.text,
      ),
  },
  {
    code: 'REGION_MISMATCH',
    match: (f) =>
      /region (mismatch|not (supported|available))|not (supported|available) in your (region|country)|地区不匹配|区域不匹配|不在服务(区|地区)/i.test(
        f.text,
      ),
  },
  {
    code: 'INSUFFICIENT_BALANCE',
    match: (f) =>
      /Arrearage|arrears|insufficient[_\s-]?(balance|funds|credit|quota)|\bbalance\b|欠费|余额不足|额度不足|payment required/i.test(
        f.text,
      ),
  },
  {
    code: 'PERMISSION_DENIED',
    match: (f) =>
      /AccessDenied|access denied|permission denied|\bforbidden\b|no permission|not authorized to|workspace|无权限|没有权限|未开通/i.test(
        f.text,
      ),
  },
  {
    code: 'RATE_LIMITED',
    match: (f) => /throttl|rate[_\s-]?limit|too many requests|请求过于频繁|限流/i.test(f.text),
  },
  {
    code: 'MODEL_NOT_FOUND',
    match: (f) =>
      /model[^.]{0,20}not found|ModelNotFound|InvalidParameter[^|]*model|unknown model|model does not exist|模型不存在|不支持的模型/i.test(
        f.text,
      ),
  },
  {
    code: 'PROVIDER_ERROR',
    match: (f) =>
      /task[_\s-]?failed|internal (server )?error|InternalError|SystemError|ServiceUnavailable|service unavailable|bad gateway|系统繁忙|服务(器)?异常/i.test(
        f.text,
      ),
  },
];

/**
 * Turn any thrown value into a user-facing verdict.
 *
 * `ctx` is not used for matching today — every rule is provider-agnostic on
 * purpose — but it is part of the signature so a provider-specific quirk can
 * be added later without touching every call site.
 */
export function normalizeProviderError(
  err: unknown,
  ctx: ProviderErrorContext,
): NormalizedProviderError {
  void ctx;
  const facts = describeError(err);
  const code = PROVIDER_ERROR_RULES.find((r) => r.match(facts))?.code ?? 'UNKNOWN_ERROR';
  const messages = PROVIDER_TEST_MESSAGES[code];
  return {
    code,
    messageZh: messages.zh,
    messageEn: messages.en,
    retryable: isRetryable(code),
    providerRequestId: extractRequestId(facts.text),
  };
}
