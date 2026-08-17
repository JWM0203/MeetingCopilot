/**
 * The only way a renderer can reach the OS browser.
 *
 * Both windows deny `window.open` and prevent `will-navigate`, so links are
 * opened by the main process on request — which makes this the single choke
 * point an attacker (or a careless string concat) would have to get through.
 * The rule is deliberately narrow: https only, and an EXACT hostname match
 * against the catalog allowlist. No suffix matching, no user-entered custom
 * provider URLs, no webviews.
 */
import { shell } from 'electron';
import { EXTERNAL_LINK_ALLOWED_HOSTS } from '../shared/providerCatalog';

/** anything longer is not a documentation link we shipped */
const MAX_URL_LENGTH = 2048;

/**
 * Pure predicate (unit-tested without electron).
 *
 * Rejects, among others:
 *  - non-https schemes: http:, file:, javascript:, data:, custom app schemes
 *  - suffix forgery:    https://platform.deepseek.com.evil.example/
 *  - userinfo dressing: https://platform.deepseek.com@evil.example/
 *  - credential prefix: https://evil.example@platform.deepseek.com/
 */
export function isAllowedExternalUrl(url: unknown): boolean {
  if (typeof url !== 'string' || url.length === 0 || url.length > MAX_URL_LENGTH) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  // a URL carrying credentials is always a phishing shape for our use case
  if (parsed.username !== '' || parsed.password !== '') return false;
  // URL already lowercases + punycodes the host; compare it whole, never by suffix
  return EXTERNAL_LINK_ALLOWED_HOSTS.includes(parsed.hostname);
}

/** Validate and hand the URL to the OS browser. Returns false when refused. */
export async function openExternalUrl(url: unknown): Promise<boolean> {
  if (!isAllowedExternalUrl(url)) {
    const shown = typeof url === 'string' ? url.slice(0, 120) : typeof url;
    console.warn(`[links] refused to open a non-allowlisted URL: ${shown}`);
    return false;
  }
  try {
    await shell.openExternal(url as string);
    return true;
  } catch (e) {
    console.warn('[links] openExternal failed:', (e as Error).message);
    return false;
  }
}
