/**
 * Secret redaction for anything that may be shown to a human or copied out of
 * the app (diagnostics report, error ring buffer, console lines).
 *
 * Pure and dependency-free so BOTH the main process and the renderer can use
 * it — the renderer may only import from `shared/`.
 *
 * Design rules:
 *  - keep the FIRST 4 characters of a secret and replace the rest with
 *    `…[redacted]`, so a user can still tell two different keys apart while
 *    the value itself is useless to anyone reading the report;
 *  - never drop the surrounding text: a diagnostics line is only useful if the
 *    message around the secret survives intact;
 *  - the output must be stable under a second pass (redacting twice changes
 *    nothing), because sanitized lines get re-serialized into the report.
 */

/** what replaces the tail of every matched secret */
const MARK = '…[redacted]';

/**
 * First 4 characters + marker. An already-masked value is re-masked to itself,
 * which is what keeps a second redaction pass a no-op.
 */
function mask(secret: string): string {
  const marked = secret.indexOf(MARK);
  const raw = marked >= 0 ? secret.slice(0, marked) : secret;
  return `${raw.slice(0, 4)}${MARK}`;
}

/**
 * `Authorization: Bearer sk-xxxx` / `authorization=<token>`.
 * The scheme word (Bearer/Basic) is kept — it is diagnostic, not secret.
 */
const AUTH_HEADER = /(\bauthorization\b\s*[:=]\s*)(bearer\s+|basic\s+)?([^\s"',;}]+)/gi;

/** `api_key: xxx`, `api-key = "xxx"`, `apiKey":"xxx"` */
const API_KEY_FIELD = /(\bapi[-_]?key\b\s*"?\s*[:=]\s*"?)([^\s"',;}]+)/gi;

/** a bare `Bearer <token>` that was not preceded by an Authorization label */
const BEARER = /(\bbearer\s+)([A-Za-z0-9._~+/=-]{8,})/gi;

/** OpenAI-style keys (DeepSeek, MiMo, …) */
const SK_KEY = /\bsk-[A-Za-z0-9_-]{8,}/g;

/** Google AI Studio / Gemini keys */
const GOOGLE_KEY = /\bAIza[0-9A-Za-z_-]{10,}/g;

/**
 * Mask every credential shape we ship support for. Non-string input returns an
 * empty string rather than throwing — this runs on error paths.
 */
export function redactSecrets(input: string): string {
  if (typeof input !== 'string' || input.length === 0) return '';
  return input
    .replace(
      AUTH_HEADER,
      (_m, label: string, scheme: string | undefined, token: string) =>
        `${label}${scheme ?? ''}${mask(token)}`,
    )
    .replace(API_KEY_FIELD, (_m, label: string, value: string) => `${label}${mask(value)}`)
    .replace(BEARER, (_m, label: string, token: string) => `${label}${mask(token)}`)
    .replace(SK_KEY, (m: string) => mask(m))
    .replace(GOOGLE_KEY, (m: string) => mask(m));
}
