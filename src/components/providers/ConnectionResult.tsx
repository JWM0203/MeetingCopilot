/**
 * One connection-test verdict, rendered the same way everywhere.
 *
 * Shared by the first-run wizard (src/onboarding) and the settings panel, which
 * live in DIFFERENT renderer entries with different dictionaries and different
 * stylesheets. Hence the shape of this component:
 *  - it takes copy as props instead of calling `useT()` — the wizard has no
 *    access to the main window's dictionary and vice versa;
 *  - it receives the already-localized `message`/`hint` strings, because the
 *    verdict text is produced main-side (ProviderTestResult carries both
 *    languages) while the action hint is mirrored in each renderer dictionary;
 *  - it only uses `.conn-*` class names, which BOTH stylesheets define against
 *    their own theme tokens (src/styles.css and src/onboarding/setup.css).
 *
 * It never sees an API key: `ProviderTestResult` deliberately has no field for
 * one, and the raw provider error never leaves the main process.
 */
import { useState, type ReactNode } from 'react';
import type { ProviderTestResult } from '../../../shared/protocol';

export interface ConnectionResultCopy {
  /** BCP-47 tag used to format the timestamp (dict.locale) */
  locale: string;
  testing: string;
  /** 「连接成功 · 482 ms」 */
  success: (latencyMs?: number) => string;
  failed: string;
  /** includes its own separator, e.g. 「建议：」 / 'Suggestion: ' */
  hintLabel: string;
  retryableNote: string;
  detailShow: string;
  detailHide: string;
  detailCode: string;
  detailRequestId: string;
  detailTime: string;
}

export interface ConnectionResultProps {
  copy: ConnectionResultCopy;
  /** null = this probe has not run yet */
  result: ProviderTestResult | null;
  /** the probe is in flight right now */
  testing?: boolean;
  /** shown in front of the state when a card runs more than one probe */
  label?: string;
  /** result.messageZh or result.messageEn, picked by the caller */
  message?: string;
  /** action hint for result.code, in the caller's language */
  hint?: string;
  /** when the verdict was produced (ISO-8601 string, epoch ms or Date) */
  at?: string | number | Date;
  /** recovery buttons ([重新填写] / [打开 Key 页面] / …) */
  children?: ReactNode;
}

function formatTime(at: string | number | Date | undefined, locale: string): string | null {
  if (at === undefined) return null;
  const d = at instanceof Date ? at : new Date(at);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleString(locale);
}

export function ConnectionResult({
  copy,
  result,
  testing,
  label,
  message,
  hint,
  at,
  children,
}: ConnectionResultProps) {
  const [detail, setDetail] = useState(false);

  if (!result && !testing) return null;

  const tag = testing ? 'tag tag-wait' : result?.ok ? 'tag tag-ok' : 'tag tag-err';
  const state = testing
    ? copy.testing
    : result?.ok
      ? copy.success(result.latencyMs)
      : copy.failed;
  const time = formatTime(at, copy.locale);

  return (
    <div className="conn-result">
      <div className="conn-line">
        {label && <span className="conn-label">{label}</span>}
        <span className={tag}>{state}</span>
        {!testing && result && !result.ok && message && <span className="conn-msg">{message}</span>}
      </div>

      {!testing && result && !result.ok && (
        <>
          {hint && <div className="conn-hint">{`${copy.hintLabel}${hint}`}</div>}
          {result.retryable && <div className="conn-hint">{copy.retryableNote}</div>}
          {children && <div className="conn-actions">{children}</div>}
          <button className="conn-detail-toggle" onClick={() => setDetail((v) => !v)}>
            {detail ? copy.detailHide : copy.detailShow}
          </button>
          {detail && (
            <div className="conn-detail">
              <div>
                <span className="conn-detail-k">{copy.detailCode}</span>
                <span className="conn-detail-v">{result.code}</span>
              </div>
              {result.providerRequestId && (
                <div>
                  <span className="conn-detail-k">{copy.detailRequestId}</span>
                  <span className="conn-detail-v">{result.providerRequestId}</span>
                </div>
              )}
              {time && (
                <div>
                  <span className="conn-detail-k">{copy.detailTime}</span>
                  <span className="conn-detail-v">{time}</span>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
