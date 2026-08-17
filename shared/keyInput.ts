/**
 * API-key paste hygiene (pure, renderer-safe).
 *
 * Users paste keys out of terminals, docs and password managers, so the value
 * routinely arrives wrapped in quotes, prefixed with `Bearer ` (copied from a
 * curl example) or padded with a trailing newline. Each of those produces a
 * 401 that looks exactly like a wrong key.
 *
 * We only ever strip at the EDGES. Interior characters are never touched — a
 * key legitimately containing quotes or spaces must survive byte-for-byte.
 */

export type ApiKeyWarning = 'trimmed' | 'quotes' | 'bearer';

export interface SanitizedApiKey {
  value: string;
  /** what was removed, in the order it was first detected (deduplicated) */
  warnings: ApiKeyWarning[];
}

/** matched quote pairs we are willing to unwrap (ASCII + CJK full-width) */
const QUOTE_PAIRS: readonly [string, string][] = [
  ['"', '"'],
  ["'", "'"],
  ['`', '`'],
  ['“', '”'], // “ ”
  ['‘', '’'], // ‘ ’
];

/** `Bearer ` / `bearer\t` … — the auth-header prefix, not part of the key */
const BEARER_RE = /^bearer[ \t]+/i;

/** paranoia bound: each pass removes at least one character, but never loop forever */
const MAX_PASSES = 8;

export function sanitizeApiKeyInput(raw: string): SanitizedApiKey {
  let value = typeof raw === 'string' ? raw : '';
  const seen = new Set<ApiKeyWarning>();
  const warnings: ApiKeyWarning[] = [];
  const warn = (w: ApiKeyWarning): void => {
    if (seen.has(w)) return;
    seen.add(w);
    warnings.push(w);
  };

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let changed = false;

    const trimmed = value.trim();
    if (trimmed !== value) {
      value = trimmed;
      warn('trimmed');
      changed = true;
    }

    const unquoted = stripOuterQuotes(value);
    if (unquoted !== null) {
      value = unquoted;
      warn('quotes');
      changed = true;
    }

    if (BEARER_RE.test(value)) {
      value = value.replace(BEARER_RE, '');
      warn('bearer');
      changed = true;
    }

    if (!changed) break;
  }

  return { value, warnings };
}

/**
 * Unwrap ONE matched quote pair, or return null when the value is not wrapped.
 * Conservative on purpose: the closing quote must not also appear inside, so
 * `"a"+"b"` is left alone rather than silently turned into `a"+"b`.
 */
function stripOuterQuotes(value: string): string | null {
  if (value.length < 2) return null;
  const first = value[0];
  const last = value[value.length - 1];
  for (const [open, close] of QUOTE_PAIRS) {
    if (first !== open || last !== close) continue;
    const inner = value.slice(1, -1);
    if (inner.length === 0) return null; // '""' is not a key; leave it visible
    if (inner.includes(close)) return null; // ambiguous — do not guess
    if (open === close && inner.includes(open)) return null;
    return inner;
  }
  return null;
}
