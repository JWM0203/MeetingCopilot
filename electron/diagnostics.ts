/**
 * Local, opt-in support data. Nothing here leaves the machine on its own:
 * there is no telemetry, no upload and no file written — the user copies a
 * report to the clipboard and decides where it goes.
 *
 * Pure by design (no electron, no fs): the main process feeds it facts and
 * gets a string back, which keeps the exclusion rules unit-testable.
 */
import type {
  ProviderSlot,
  ProviderVerification,
  SettingsFile,
  UiLang,
} from '../shared/protocol';
import {
  findPresetByEndpoint,
  providerIdForEndpoint,
  type ProviderCapability,
} from '../shared/providerCatalog';
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

// ---------- local python probe ----------

export type ProbeStatus = 'yes' | 'no' | 'unknown';

/**
 * "Is there a python that could run the local ASR sidecar?" is worth a line in
 * the report but is NOT worth blocking on: resolving it spawns `python
 * --version` for each candidate, and on a machine with a broken PATH entry
 * that can stall for seconds.
 *
 * So it runs exactly once per process, in the background, and the report reads
 * whatever the cache holds at that moment — `unknown` while the probe is still
 * out. A report the user is still waiting for is worse than a report with one
 * soft field, and the next request picks up the settled answer.
 *
 * There is deliberately NO timeout that gives up on the probe: racing it
 * against a timer would both discard a late (but correct) answer and leave the
 * loser's rejection unhandled in the main process.
 */
export class LocalPythonProbe {
  private state: ProbeStatus = 'unknown';
  private started = false;

  constructor(private readonly run: () => Promise<unknown>) {}

  get status(): ProbeStatus {
    return this.state;
  }

  /** idempotent and non-blocking; safe to call on every diagnostics request */
  start(): void {
    if (this.started) return;
    this.started = true;
    void this.run().then(
      () => {
        this.state = 'yes';
      },
      () => {
        this.state = 'no';
      },
    );
  }
}

// ---------- the report ----------

/** everything the report is allowed to know. No stores, no electron, no fs. */
export interface DiagnosticsFacts {
  appVersion: string;
  packaged: boolean;
  platform: string;
  arch: string;
  osRelease: string;
  electronVersion?: string;
  nodeVersion?: string;
  uiLang: UiLang;
  /** the settings FILE — keys are read as booleans only, never as values */
  settings: SettingsFile;
  /** true when the OS credential store was unavailable (keys only obfuscated) */
  weakCrypto: boolean;
  /** size only; the knowledge text itself must never appear */
  knowledgeChars: number;
  capture: { active: boolean; lastStartedAt?: string; lastStoppedAt?: string };
  asr: { ready: boolean; ep?: string; gpuSuspect?: boolean; state?: string };
  localPython: ProbeStatus;
  errors: DiagnosticErrorEntry[];
  generatedAt: Date;
}

const HEADER = [
  'MeetingCopilot Diagnostic Report',
  'Generated locally. Sensitive content and API keys are excluded.',
];

const yesNo = (v: boolean): string => (v ? 'yes' : 'no');

/**
 * Name a configured endpoint from the CATALOG, never from the stored
 * `providerId`: that field can be stale (written by an older build, or left
 * behind when the user hand-edited a base URL), and a diagnostics report that
 * names the wrong provider sends the reader down the wrong path.
 */
function describeEndpoint(
  baseUrl: string | undefined,
  model: string | undefined,
  capability: ProviderCapability,
): string {
  if (!baseUrl || !model) return 'not configured';
  const preset = findPresetByEndpoint(baseUrl, model, capability);
  const provider = preset?.providerId ?? providerIdForEndpoint(baseUrl, model, capability);
  return `${provider} / ${model}`;
}

function describeVerification(v: ProviderVerification | undefined): string {
  if (!v?.lastTestCode && !v?.lastTestAt) return 'never tested';
  const latency = v.latencyMs === undefined ? '' : ` (${v.latencyMs} ms)`;
  return `${v.lastTestCode ?? (v.lastTestOk ? 'OK' : 'UNKNOWN_ERROR')} at ${v.lastTestAt ?? 'unknown time'}${latency}`;
}

function pad(label: string): string {
  return label.padEnd(21, ' ');
}

/**
 * Build the plaintext support report the user copies to the clipboard.
 *
 * EXCLUDED BY CONSTRUCTION (spec §D): API keys and their ciphertext,
 * Authorization headers, resume / JD / knowledge-base text, transcripts,
 * answers, audio, screenshots and absolute user paths. Keys appear as
 * yes/no per slot; the knowledge base appears as a character count. Errors
 * come from the ring buffer, which redacted them on the way in.
 */
export function buildDiagnosticsReport(f: DiagnosticsFacts): string {
  const s = f.settings;
  const asr = s.asr;
  const backend = asr.backend ?? 'local';
  const asrEndpoint =
    backend === 'cloud-realtime'
      ? describeEndpoint(asr.realtime?.baseUrl, asr.realtime?.model, 'asr-realtime')
      : backend === 'cloud'
        ? describeEndpoint(asr.cloud?.baseUrl, asr.cloud?.model, 'asr-segment')
        : backend === 'local-realtime'
          ? `local sidecar / ${asr.localRealtime?.model ?? 'unknown'}`
          : 'local whisper';

  const keySlots: [ProviderSlot, boolean][] = [
    ['llm', !!s.llm.apiKeyEnc],
    ['vision', !!s.vision.apiKeyEnc],
    ['asr-cloud', !!asr.cloud?.apiKeyEnc],
    ['asr-realtime', !!asr.realtime?.apiKeyEnc],
  ];

  const verifications: [ProviderSlot, ProviderVerification | undefined][] = [
    ['llm', s.llm.verification],
    ['vision', s.vision.verification],
    ['asr-cloud', asr.cloud?.verification],
    ['asr-realtime', asr.realtime?.verification],
  ];

  const lines: string[] = [
    ...HEADER,
    '',
    `${pad('Generated at')}: ${f.generatedAt.toISOString()}`,
    `${pad('Version')}: ${f.appVersion} (packaged: ${yesNo(f.packaged)})`,
    `${pad('Runtime')}: electron ${f.electronVersion ?? 'unknown'} / node ${f.nodeVersion ?? 'unknown'}`,
    `${pad('OS')}: ${f.platform} ${f.arch} ${f.osRelease}`,
    `${pad('UI language')}: ${s.ui.lang ?? f.uiLang} (${s.ui.lang ? 'explicit' : 'from OS locale'})`,
    `${pad('Onboarding')}: completed=${yesNo(s.onboarding.completed)} plan=${s.onboarding.selectedPlan ?? 'none'} migratedFromV1=${yesNo(!!s.onboarding.migratedFromV1)}`,
    '',
    `${pad('ASR backend')}: ${backend}`,
    `${pad('ASR provider')}: ${asrEndpoint}`,
    `${pad('ASR language')}: ${asr.language}`,
    `${pad('ASR worker')}: ready=${yesNo(f.asr.ready)} state=${f.asr.state ?? 'unknown'} ep=${f.asr.ep ?? 'unknown'} gpuSuspect=${yesNo(!!f.asr.gpuSuspect)}`,
    `${pad('LLM provider')}: ${describeEndpoint(s.llm.baseUrl, s.llm.model, 'text-llm')}`,
    `${pad('LLM answer lang')}: ${s.llm.answerLang}`,
    `${pad('Vision configured')}: ${yesNo(!!(s.vision.baseUrl && s.vision.model))} (${describeEndpoint(s.vision.baseUrl, s.vision.model, 'vision')})`,
    `${pad('Answer with vision')}: ${yesNo(!!s.llm.answerWithVision)}`,
    '',
    `${pad('API keys configured')}: ${keySlots.map(([slot, set]) => `${slot}=${yesNo(set)}`).join(' ')}`,
    `${pad('Key storage')}: ${f.weakCrypto ? 'obfuscated only (OS credential store unavailable)' : 'OS-encrypted'}`,
    `${pad('Last connection test')}:`,
    ...verifications.map(([slot, v]) => `  ${slot.padEnd(19, ' ')}: ${describeVerification(v)}`),
    '',
    `${pad('Audio capture')}: ${f.capture.active ? 'active' : 'idle'} lastStarted=${f.capture.lastStartedAt ?? 'never'} lastStopped=${f.capture.lastStoppedAt ?? 'never'}`,
    `${pad('System audio device')}: ${s.audio.themDeviceId ? 'selected' : 'system default'}`,
    `${pad('Microphone')}: enabled=${yesNo(s.audio.micEnabled)} device=${s.audio.micDeviceId ? 'selected' : 'system default'}`,
    `${pad('Local python')}: ${f.localPython}`,
    `${pad('Proxy configured')}: ${yesNo(!!s.vision.proxyUrl)}`,
    `${pad('Knowledge base')}: ${f.knowledgeChars} chars (content excluded)`,
    `${pad('Custom models dir')}: ${yesNo(!!asr.modelsDir)}`,
    '',
    `Recent errors (sanitized, oldest first, ${f.errors.length}):`,
    ...(f.errors.length === 0
      ? ['  none']
      : f.errors.map((e) => `  ${e.at} [${e.scope}] ${e.message}`)),
  ];

  // belt and braces: the ring buffer redacts on the way in, and every other
  // line is built from booleans, but the whole report is swept once more so a
  // future field cannot quietly become a leak
  return redactSecrets(lines.join('\n'));
}
