/**
 * Local, opt-in support data. Nothing here leaves the machine on its own:
 * there is no telemetry, no upload and no file written — the user copies a
 * report to the clipboard and decides where it goes.
 *
 * Pure by design (no electron, no fs): the main process feeds it facts and
 * gets a string back, which keeps the exclusion rules unit-testable.
 */
import { redactSecrets } from '../shared/redact';

// ---------- sanitized error ring buffer ----------

/** how many recent failures the report may carry */
export const DIAGNOSTIC_ERROR_LIMIT = 50;

export interface DiagnosticErrorEntry {
  /** ISO-8601 */
  at: string;
  /** where it came from, e.g. 'provider-test/text-llm', 'sidecar', 'asr' */
  scope: string;
  /** ALREADY passed through redactSecrets */
  message: string;
}

/** newest last; capped at DIAGNOSTIC_ERROR_LIMIT */
const ring: DiagnosticErrorEntry[] = [];

/** anything longer is a stack trace or a response body, not a diagnosis */
const MAX_ENTRY_CHARS = 400;

/**
 * Record one failure for the support report. Redaction happens HERE so no
 * caller can forget it, and so the buffer itself never holds key material.
 */
export function recordDiagnosticError(
  scope: string,
  message: string,
  now: Date = new Date(),
): void {
  const clean = redactSecrets(String(message ?? '')).slice(0, MAX_ENTRY_CHARS);
  if (!clean) return;
  ring.push({ at: now.toISOString(), scope, message: clean });
  if (ring.length > DIAGNOSTIC_ERROR_LIMIT) ring.splice(0, ring.length - DIAGNOSTIC_ERROR_LIMIT);
}

export function recentDiagnosticErrors(): DiagnosticErrorEntry[] {
  return ring.map((e) => ({ ...e }));
}

/** test hook; the app never clears the buffer while it runs */
export function clearDiagnosticErrors(): void {
  ring.length = 0;
}
