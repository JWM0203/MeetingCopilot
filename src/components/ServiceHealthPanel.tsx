/**
 * 服务状态 overlay (spec §E.4): one row per service, in plain words, with the
 * three actions that can actually fix something — 打开设置 / 重新测试 / 打开配置
 * 向导.
 *
 * The states come from shared/healthState.ts, so this panel, the status-bar
 * chips and the answer-button gating cannot disagree. Nothing here blocks the
 * app: a failed row is information, and the app keeps running around it (ASR
 * without an LLM still transcribes, an LLM without ASR still answers typed
 * questions).
 */
import { useState } from 'react';
import type {
  ProviderSlot,
  ProviderTestResult,
  ProviderVerification,
  PublicSettings,
} from '../../shared/protocol';
import {
  chipTone,
  type ServiceHealth,
  type ServiceHealthReport,
} from '../../shared/healthState';
import {
  isTestableTarget,
  storedKeyTest,
  type EndpointTarget,
} from '../../shared/providerTestRequests';
import { PROVIDER_HELP, findPresetByEndpoint, providerIdForEndpoint } from '../../shared/providerCatalog';
import { useT } from '../i18n';
import { ConnectionResult } from './providers/ConnectionResult';
import { connectionResultCopy } from './providers/copy';

const TONE_CLASS: Record<string, string> = {
  ok: 'tag tag-ok',
  busy: 'tag tag-wait',
  bad: 'tag tag-err',
  none: 'tag',
};

/** stored endpoint for a slot; undefined when the service has no cloud side */
function targetForSlot(s: PublicSettings, slot: ProviderSlot): EndpointTarget | undefined {
  switch (slot) {
    case 'llm':
      return {
        capability: 'text-llm',
        providerId: providerIdForEndpoint(s.llm.baseUrl, s.llm.model, 'text-llm'),
        baseUrl: s.llm.baseUrl,
        model: s.llm.model,
        slot,
      };
    case 'vision':
      return {
        capability: 'vision',
        providerId: providerIdForEndpoint(s.vision.baseUrl, s.vision.model, 'vision'),
        baseUrl: s.vision.baseUrl ?? '',
        model: s.vision.model ?? '',
        slot,
        ...(s.vision.proxyUrl ? { proxyUrl: s.vision.proxyUrl } : {}),
      };
    case 'asr-cloud':
      return {
        capability: 'asr-segment',
        providerId: providerIdForEndpoint(s.asr.cloud.baseUrl, s.asr.cloud.model, 'asr-segment'),
        baseUrl: s.asr.cloud.baseUrl ?? '',
        model: s.asr.cloud.model ?? '',
        slot,
      };
    case 'asr-realtime':
    default:
      return {
        capability: 'asr-realtime',
        providerId: providerIdForEndpoint(
          s.asr.realtime.baseUrl,
          s.asr.realtime.model,
          'asr-realtime',
        ),
        baseUrl: s.asr.realtime.baseUrl ?? '',
        model: s.asr.realtime.model ?? '',
        slot,
      };
  }
}

export interface ServiceHealthPanelProps {
  settings: PublicSettings;
  health: ServiceHealthReport;
  onClose: () => void;
  onOpenSettings: () => void;
  onOpenDiagnostics: () => void;
  /** re-read the public settings after a test recorded a fresh verdict */
  onSettingsRefreshed: (s: PublicSettings) => void;
}

export function ServiceHealthPanel({
  settings,
  health,
  onClose,
  onOpenSettings,
  onOpenDiagnostics,
  onSettingsRefreshed,
}: ServiceHealthPanelProps) {
  const t = useT();
  const copy = connectionResultCopy(t);
  const [testing, setTesting] = useState<ProviderSlot | null>(null);
  const [results, setResults] = useState<
    Partial<Record<ProviderSlot, { result: ProviderTestResult; at: number }>>
  >({});
  const [error, setError] = useState<string | null>(null);

  const runTest = async (slot: ProviderSlot, target: EndpointTarget) => {
    setTesting(slot);
    setError(null);
    setResults((r) => ({ ...r, [slot]: undefined }));
    try {
      const result = await window.mc.providerTest(storedKeyTest(target));
      setResults((r) => ({ ...r, [slot]: { result, at: Date.now() } }));
      onSettingsRefreshed(await window.mc.getSettings());
    } catch (e) {
      setError(t.settings.testCrashed((e as Error).message));
    } finally {
      setTesting(null);
    }
  };

  const verificationLine = (v: ProviderVerification | undefined): string => {
    if (!v?.lastTestAt) return t.settings.testNever;
    const when = new Date(v.lastTestAt).toLocaleString(t.locale);
    return v.lastTestOk ? t.settings.testLastOk(when, v.latencyMs) : t.settings.testLastFail(when);
  };

  const row = (h: ServiceHealth, label: string, note?: string) => {
    const target = h.slot ? targetForSlot(settings, h.slot) : undefined;
    const canTest =
      !!h.slot &&
      !!target &&
      isTestableTarget(target) &&
      h.state !== 'unconfigured' &&
      h.state !== 'off';
    const fresh = h.slot ? results[h.slot] : undefined;
    const keyUrl = target
      ? (findPresetByEndpoint(target.baseUrl, target.model, target.capability)?.help.keyUrl ??
        PROVIDER_HELP[target.providerId].keyUrl)
      : undefined;
    return (
      <div className="health-row" key={h.key}>
        <div className="conn-line">
          <span className="health-name">{label}</span>
          {h.optional && <span className="tag">{t.health.optional}</span>}
          <span className={TONE_CLASS[chipTone(h)]}>{t.health.state[h.state]}</span>
          <span className="health-actions">
            <button className="btn btn-sm" onClick={onOpenSettings}>
              {t.health.openSettings}
            </button>
            {canTest && target && (
              <button
                className="btn btn-sm"
                disabled={testing !== null}
                onClick={() => void runTest(h.slot!, target)}
              >
                {testing === h.slot ? t.health.testing : t.health.retest}
              </button>
            )}
            <button className="btn btn-sm" onClick={() => void window.mc.rerunOnboarding()}>
              {t.health.openWizard}
            </button>
          </span>
        </div>
        {note && <div className="conn-hint">{note}</div>}
        {h.detail && <div className="conn-hint">{h.detail}</div>}
        {/* a slot with nothing configured has nothing to say about test history */}
        {h.slot && !fresh && h.state !== 'off' && h.state !== 'unconfigured' && (
          <div className="conn-hint">{verificationLine(h.verification)}</div>
        )}
        {h.slot && (
          <ConnectionResult
            copy={copy}
            result={fresh?.result ?? null}
            testing={testing === h.slot}
            message={
              fresh
                ? t.uiLang === 'zh'
                  ? fresh.result.messageZh
                  : fresh.result.messageEn
                : undefined
            }
            hint={fresh ? t.settings.testHints[fresh.result.code] : undefined}
            at={fresh?.at}
          >
            {keyUrl && (
              <button className="btn btn-sm" onClick={() => void window.mc.openExternal(keyUrl)}>
                {t.settings.testOpenKeyPage}
              </button>
            )}
          </ConnectionResult>
        )}
      </div>
    );
  };

  /** the one sentence that explains a partial setup */
  const partialHint = health.needsSetup
    ? t.health.hintNeedsSetup
    : !health.answersAvailable
      ? t.health.hintAsrOnly
      : !health.transcriptionAvailable
        ? t.health.hintLlmOnly
        : null;

  return (
    <div className="settings health-panel">
      <div className="settings-section">{t.health.title}</div>
      {partialHint && <div className="settings-hint">{partialHint}</div>}

      {row(health.asr, t.health.rowAsr, health.asr.local ? t.health.localBackend : undefined)}
      {row(health.llm, t.health.rowLlm)}
      {row(
        health.audio,
        t.health.rowAudio,
        health.audio.state === 'ok' ? t.health.audioOk : t.health.audioIdle,
      )}
      {row(
        health.vision,
        t.health.rowVision,
        health.vision.state === 'off' ? t.health.visionOff : undefined,
      )}

      {error && <div className="settings-warn">{error}</div>}
      <div className="settings-hint">{t.settings.testFeeNote}</div>

      <div className="settings-actions">
        <button className="btn" onClick={onOpenDiagnostics}>
          {t.health.diagnostics}
        </button>
        <button className="btn" onClick={onClose}>
          {t.health.close}
        </button>
      </div>
    </div>
  );
}
