/**
 * Step 4 连接测试 — the audio path, the real provider round-trips and a summary
 * checklist.
 *
 * The audio test reuses the SAME capture code the app runs with
 * (src/audio/loopbackCapture.ts / micCapture.ts) but keeps the PCM inside the
 * renderer: it computes an RMS level for the meter and never forwards a frame
 * to the main process. The setup bridge deliberately exposes no `capturePcm`
 * channel, so no ASR engine can be started from here.
 *
 * The provider rows show the REAL verdict: the main process records
 * `verification` into each slot whenever a test runs (step 3 or the 重新测试
 * buttons here), so a result survives a wizard restart. 重新测试 runs against the
 * STORED key — the plaintext is long gone by then, which is the point.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { LoopbackCapture } from '../../audio/loopbackCapture';
import { MicCapture, listMics } from '../../audio/micCapture';
import { planDefinition, type KeySlot, type PlanSlot } from '../../../shared/onboardingPlans';
import { storedKeyTest, targetFromPreset } from '../../../shared/providerTestRequests';
import { ConnectionResult } from '../../components/providers/ConnectionResult';
import { connectionResultCopy } from '../connectionCopy';
import { slotState } from './ProviderStep';
import type {
  OnboardingPlan,
  ProviderTestRequest,
  ProviderTestResult,
  ProviderVerification,
  PublicSettings,
  UiLang,
} from '../../../shared/protocol';
import type { SetupDict } from '../i18n';

/** ~-48 dBFS: quiet room noise stays below, any real playback rises above */
const SILENCE_RMS = 0.004;
/** how long after the last loud frame we still call it 「检测正常」 */
const LOUD_WINDOW_MS = 2500;
const TICK_MS = 120;

type AudioState = 'idle' | 'running' | 'ok' | 'silent' | 'no-device' | 'failed';

/** rms -> 0..1 bar fill on a -60 dBFS..0 dBFS scale */
function levelBar(rms: number): number {
  if (rms <= 0) return 0;
  const db = 20 * Math.log10(rms);
  return Math.min(1, Math.max(0, (db + 60) / 60));
}

function rmsOf(buf: ArrayBuffer): number {
  const pcm = new Float32Array(buf);
  if (pcm.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < pcm.length; i++) sum += pcm[i] * pcm[i];
  return Math.sqrt(sum / pcm.length);
}

const NO_DEVICE_RE = /no audio track|NotFoundError|Requested device not found|NotAllowedError/i;

/** one provider row in the 服务连接测试 card */
interface ProviderRow extends PlanSlot {
  label: string;
}

/** last stored verdict for one wizard key slot */
export function slotVerification(
  settings: PublicSettings,
  slot: KeySlot,
): ProviderVerification | undefined {
  switch (slot) {
    case 'llm':
      return settings.llm.verification;
    case 'asr-cloud':
      return settings.asr.cloud.verification;
    case 'asr-realtime':
    default:
      return settings.asr.realtime.verification;
  }
}

/** one line for the 配置检查 summary: every needed slot passed / failed / untested */
export function testsSummary(
  settings: PublicSettings,
  slots: KeySlot[],
): 'all-ok' | 'failed' | 'partial' | 'none' {
  const states = slots.map((slot) => slotVerification(settings, slot)?.lastTestOk);
  if (states.length === 0) return 'none';
  if (states.some((ok) => ok === false)) return 'failed';
  if (states.every((ok) => ok === true)) return 'all-ok';
  if (states.some((ok) => ok === true)) return 'partial';
  return 'none';
}

export interface ConnectionStepProps {
  t: SetupDict;
  lang: UiLang;
  plan: OnboardingPlan;
  settings: PublicSettings;
  platform: NodeJS.Platform;
  /** one real provider round-trip against the STORED key */
  onTest: (req: ProviderTestRequest) => Promise<ProviderTestResult>;
  /** slots saved through 「暂时保存并稍后重试」 in this wizard run */
  savedUntested: KeySlot[];
  audioOk: boolean;
  onAudioOk: (ok: boolean) => void;
  micEnabled: boolean;
  onMicEnabled: (on: boolean) => void;
  micDeviceId: string;
  onMicDeviceId: (id: string) => void;
  themDeviceId: string;
  onThemDeviceId: (id: string) => void;
}

export function ConnectionStep({
  t,
  lang,
  plan,
  settings,
  platform,
  onTest,
  savedUntested,
  audioOk,
  onAudioOk,
  micEnabled,
  onMicEnabled,
  micDeviceId,
  onMicDeviceId,
  themDeviceId,
  onThemDeviceId,
}: ConnectionStepProps) {
  const isMac = platform === 'darwin';
  const [state, setState] = useState<AudioState>('idle');
  const [running, setRunning] = useState(false);
  const [level, setLevel] = useState(0);
  const [detail, setDetail] = useState<string | null>(null);
  const [devices, setDevices] = useState<{ deviceId: string; label: string }[]>([]);
  const [micLevel, setMicLevel] = useState(0);
  const [micError, setMicError] = useState<string | null>(null);
  /** slot whose 重新测试 is in flight */
  const [testing, setTesting] = useState<KeySlot | null>(null);
  /** verdicts produced in THIS step (step 3's live in settings.verification) */
  const [results, setResults] = useState<
    Partial<Record<KeySlot, { result: ProviderTestResult; at: number }>>
  >({});
  const [testError, setTestError] = useState<string | null>(null);

  const captureRef = useRef<LoopbackCapture | MicCapture | null>(null);
  const micRef = useRef<MicCapture | null>(null);
  const levelRef = useRef(0);
  const micLevelRef = useRef(0);
  const lastLoudRef = useRef(0);
  const runningRef = useRef(false);

  const refreshDevices = useCallback(() => {
    void listMics()
      .then(setDevices)
      .catch(() => setDevices([]));
  }, []);

  useEffect(() => {
    refreshDevices();
  }, [refreshDevices]);

  // meter/state ticker: the PCM callback only touches refs, React state is
  // refreshed here so a 16 kHz stream cannot flood the reconciler
  useEffect(() => {
    const id = setInterval(() => {
      setLevel(levelBar(levelRef.current));
      setMicLevel(levelBar(micLevelRef.current));
      levelRef.current *= 0.7;
      micLevelRef.current *= 0.7;
      if (!runningRef.current) return;
      const loud = Date.now() - lastLoudRef.current < LOUD_WINDOW_MS;
      setState(loud ? 'ok' : 'silent');
      if (loud) onAudioOk(true);
    }, TICK_MS);
    return () => clearInterval(id);
  }, [onAudioOk]);

  const stopTest = useCallback(async () => {
    runningRef.current = false;
    setRunning(false);
    const cap = captureRef.current;
    captureRef.current = null;
    await cap?.stop();
    setState((s) => (s === 'running' || s === 'ok' || s === 'silent' ? 'idle' : s));
  }, []);

  // release the device when the wizard moves on or the window closes
  useEffect(() => {
    return () => {
      runningRef.current = false;
      void captureRef.current?.stop();
      captureRef.current = null;
      void micRef.current?.stop();
      micRef.current = null;
    };
  }, []);

  const onPcm = useCallback((buf: ArrayBuffer) => {
    const rms = rmsOf(buf);
    levelRef.current = Math.max(levelRef.current, rms);
    if (rms > SILENCE_RMS) lastLoudRef.current = Date.now();
  }, []);

  const startTest = useCallback(async () => {
    await stopTest();
    setDetail(null);
    setState('running');
    lastLoudRef.current = 0;
    try {
      if (isMac) {
        const cap = new MicCapture();
        // no echo cancellation / AGC: we want the raw level of the device
        await cap.start(themDeviceId || undefined, onPcm, { audioProcessing: false });
        captureRef.current = cap;
      } else {
        const cap = new LoopbackCapture();
        await cap.start(onPcm);
        captureRef.current = cap;
      }
      runningRef.current = true;
      setRunning(true);
      refreshDevices();
    } catch (e) {
      const msg = (e as Error).message;
      runningRef.current = false;
      setRunning(false);
      captureRef.current = null;
      setDetail(msg);
      setState(NO_DEVICE_RE.test(msg) ? 'no-device' : 'failed');
    }
  }, [isMac, onPcm, refreshDevices, stopTest, themDeviceId]);

  // microphone preview: only alive while 「启用麦克风」 is selected
  useEffect(() => {
    let cancelled = false;
    if (!micEnabled) {
      void micRef.current?.stop();
      micRef.current = null;
      micLevelRef.current = 0;
      setMicError(null);
      return;
    }
    void (async () => {
      await micRef.current?.stop();
      micRef.current = null;
      const cap = new MicCapture();
      try {
        await cap.start(micDeviceId || undefined, (buf) => {
          micLevelRef.current = Math.max(micLevelRef.current, rmsOf(buf));
        });
        if (cancelled) {
          await cap.stop();
          return;
        }
        micRef.current = cap;
        setMicError(null);
        refreshDevices();
      } catch (e) {
        if (!cancelled) setMicError(t.connection.micPermissionFail((e as Error).message));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [micEnabled, micDeviceId, refreshDevices, t]);

  const def = planDefinition(plan);
  const asrKey = def.asr ? slotState(settings, def.asr.slot) : null;
  const llmKey = def.llm ? slotState(settings, def.llm.slot) : null;

  // ---- provider connection tests (stored key, explicit click only) ----
  const providerRows: ProviderRow[] = [
    ...(def.asr ? [{ ...def.asr, label: t.provider.rowAsrTest }] : []),
    ...(def.llm ? [{ ...def.llm, label: t.provider.rowLlmTest }] : []),
  ];
  const summary = testsSummary(
    settings,
    providerRows.map((p) => p.slot),
  );
  const copy = connectionResultCopy(t);
  const summaryText =
    summary === 'all-ok'
      ? t.connection.testsAllOk
      : summary === 'failed'
        ? t.connection.testsHasFail
        : summary === 'partial'
          ? t.connection.testsPartial
          : t.connection.untested;
  const summaryTag =
    summary === 'all-ok' ? 'tag tag-ok' : summary === 'failed' ? 'tag tag-err' : 'tag';

  const storedTagClass = (v: ProviderVerification | undefined): string =>
    v?.lastTestOk === true ? 'tag tag-ok' : v?.lastTestOk === false ? 'tag tag-err' : 'tag';
  /** a slot the user saved through 「暂时保存并稍后重试」 reads differently from
   * one that was simply never touched — the former is a deliberate ○ */
  const storedTagText = (slot: KeySlot, v: ProviderVerification | undefined): string =>
    v?.lastTestOk === true
      ? t.connection.lastOk(v.latencyMs)
      : v?.lastTestOk === false
        ? t.connection.lastFail
        : savedUntested.includes(slot)
          ? t.connection.savedUntestedTag
          : t.connection.neverTested;

  const runProviderTest = async (row: ProviderRow) => {
    setTesting(row.slot);
    setTestError(null);
    setResults((r) => ({ ...r, [row.slot]: undefined }));
    try {
      const result = await onTest(storedKeyTest(targetFromPreset(row.preset, row.slot)));
      setResults((r) => ({ ...r, [row.slot]: { result, at: Date.now() } }));
    } catch (e) {
      setTestError(t.provider.testCrashed((e as Error).message));
    } finally {
      setTesting(null);
    }
  };

  const stateLabel: Record<AudioState, string> = {
    idle: t.connection.stateIdle,
    running: t.connection.stateRunning,
    ok: t.connection.stateOk,
    silent: t.connection.stateSilent,
    'no-device': t.connection.stateNoDevice,
    failed: t.connection.stateFail,
  };
  const stateTag =
    state === 'ok' ? 'tag tag-ok' : state === 'idle' || state === 'running' ? 'tag' : 'tag tag-beta';
  const showHelp = state === 'silent' || state === 'no-device' || state === 'failed';

  const row = (
    key: string,
    kind: 'ok' | 'todo' | 'na',
    label: string,
    value: string,
  ) => (
    <div key={key} className={`check-row is-${kind}`}>
      <span className="check-mark">{kind === 'ok' ? '✓' : kind === 'todo' ? '○' : '–'}</span>
      <span className="check-label">{label}</span>
      <span className="check-value">{value}</span>
    </div>
  );

  return (
    <div>
      <h1 className="setup-h1">{t.connection.title}</h1>
      <p className="setup-sub">{t.connection.subtitle}</p>

      <section className="setup-card">
        <div className="key-card-head">
          <div className="setup-card-title">
            {isMac ? t.connection.macTitle : t.connection.audioTitle}
          </div>
          <span className={stateTag}>{stateLabel[state]}</span>
        </div>
        <p style={{ color: 'var(--text-body)', fontSize: 13 }}>
          {isMac ? t.connection.macHint : t.connection.audioIntro}
        </p>

        {isMac && (
          <div className="setup-field">
            <span className="setup-field-label">{t.connection.macDevice}</span>
            <select
              className="setup-select"
              value={themDeviceId}
              onChange={(e) => onThemDeviceId(e.target.value)}
            >
              <option value="">{t.connection.micDefault}</option>
              {devices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || d.deviceId}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="meter-row">
          <span className="meter-label">{t.connection.level}</span>
          <div className="meter">
            <div className="meter-fill" style={{ width: `${Math.round(level * 100)}%` }} />
          </div>
        </div>

        <div className="key-actions" style={{ marginTop: 12 }}>
          {running ? (
            <>
              <button className="btn" onClick={() => void stopTest()}>
                {t.connection.stopTest}
              </button>
              <button className="btn btn-sm" onClick={() => void startTest()}>
                {t.connection.retest}
              </button>
            </>
          ) : (
            <button className="btn btn-primary" onClick={() => void startTest()}>
              {state === 'idle' ? t.connection.startTest : t.connection.retest}
            </button>
          )}
        </div>

        {detail && <div className="key-notice key-notice-err">{detail}</div>}

        {showHelp && (
          <div className="key-tutorial">
            <div className="key-section-title">{t.connection.helpTitle}</div>
            <ol>
              {t.connection.help.map((h) => (
                <li key={h}>{h}</li>
              ))}
            </ol>
          </div>
        )}
      </section>

      <section className="setup-card">
        <div className="key-card-head">
          <div className="setup-card-title">{t.connection.micTitle}</div>
          <span className="tag">{t.common.optional}</span>
        </div>
        <div className="setup-radios">
          <label className="setup-radio">
            <input type="radio" checked={!micEnabled} onChange={() => onMicEnabled(false)} />
            <span>{t.connection.micOff}</span>
          </label>
          <label className="setup-radio">
            <input type="radio" checked={micEnabled} onChange={() => onMicEnabled(true)} />
            <span>{t.connection.micOn}</span>
          </label>
        </div>
        {micEnabled && (
          <>
            <div className="setup-field">
              <span className="setup-field-label">{t.connection.micDevice}</span>
              <select
                className="setup-select"
                value={micDeviceId}
                onChange={(e) => onMicDeviceId(e.target.value)}
              >
                <option value="">{t.connection.micDefault}</option>
                {devices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || d.deviceId}
                  </option>
                ))}
              </select>
            </div>
            <div className="meter-row">
              <span className="meter-label">{t.connection.level}</span>
              <div className="meter">
                <div className="meter-fill" style={{ width: `${Math.round(micLevel * 100)}%` }} />
              </div>
            </div>
            {micError && <div className="key-notice key-notice-err">{micError}</div>}
          </>
        )}
        <div className="key-hint">{t.connection.micHint}</div>
      </section>

      {providerRows.length > 0 && (
        <section className="setup-card">
          <div className="key-card-head">
            <div className="setup-card-title">{t.connection.testsTitle}</div>
            <span className={summaryTag}>{summaryText}</span>
          </div>
          <p style={{ color: 'var(--text-body)', fontSize: 13 }}>{t.connection.testsIntro}</p>

          {providerRows.map((row) => {
            const configured = slotState(settings, row.slot).configured;
            const fresh = results[row.slot];
            const stored = slotVerification(settings, row.slot);
            return (
              <div className="conn-provider" key={row.slot}>
                <div className="conn-line">
                  <span className="conn-label">{row.label}</span>
                  {!configured ? (
                    <span className="tag">{t.connection.noKeyYet}</span>
                  ) : !fresh ? (
                    <span className={storedTagClass(stored)}>
                      {storedTagText(row.slot, stored)}
                    </span>
                  ) : null}
                  <button
                    className="btn btn-sm"
                    disabled={!configured || testing !== null}
                    onClick={() => void runProviderTest(row)}
                  >
                    {testing === row.slot ? t.provider.testing : t.connection.retestProvider}
                  </button>
                </div>
                {!fresh && stored?.lastTestAt && (
                  <div className="conn-hint">
                    {t.connection.testedAt(new Date(stored.lastTestAt).toLocaleString(t.locale))}
                  </div>
                )}
                {!fresh && stored?.lastTestOk === false && stored.lastTestCode && (
                  <div className="conn-hint">
                    {`${t.provider.hintLabel}${t.provider.actionHints[stored.lastTestCode]}`}
                  </div>
                )}
                <ConnectionResult
                  copy={copy}
                  result={fresh?.result ?? null}
                  testing={testing === row.slot}
                  message={
                    fresh
                      ? lang === 'zh'
                        ? fresh.result.messageZh
                        : fresh.result.messageEn
                      : undefined
                  }
                  hint={fresh ? t.provider.actionHints[fresh.result.code] : undefined}
                  at={fresh?.at}
                />
              </div>
            );
          })}

          {testError && <div className="key-notice key-notice-err">{testError}</div>}
          <div className="key-hint">{t.provider.feeNote}</div>
          <div className="key-hint">{t.connection.untestedHint}</div>
        </section>
      )}

      <section className="setup-card">
        <div className="setup-card-title">{t.connection.summaryTitle}</div>
        <div className="check-list">
          {asrKey &&
            row(
              'asr',
              asrKey.configured ? 'ok' : 'todo',
              t.connection.rowAsrKey,
              asrKey.configured ? t.connection.saved : t.connection.unsaved,
            )}
          {llmKey
            ? row(
                'llm',
                llmKey.configured ? 'ok' : 'todo',
                t.connection.rowLlmKey,
                llmKey.configured ? t.connection.saved : t.connection.unsaved,
              )
            : row('llm', 'na', t.connection.rowLlmKey, t.connection.notNeeded)}
          {row(
            'audio',
            audioOk ? 'ok' : 'todo',
            t.connection.rowAudio,
            audioOk ? t.connection.stateOk : stateLabel[state],
          )}
          {row(
            'mic',
            micEnabled ? 'ok' : 'na',
            t.connection.rowMic,
            micEnabled ? t.connection.enabled : t.connection.disabled,
          )}
          {row('vision', 'na', t.connection.rowVision, t.connection.visionUnset)}
          {row(
            'test',
            providerRows.length === 0 ? 'na' : summary === 'all-ok' ? 'ok' : 'todo',
            t.connection.rowTest,
            providerRows.length === 0 ? t.connection.notNeeded : summaryText,
          )}
        </div>
      </section>
    </div>
  );
}
