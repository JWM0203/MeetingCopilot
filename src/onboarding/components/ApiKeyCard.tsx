/**
 * One provider = one card: where to get the key (official page + an inline
 * step-by-step guide from the catalog), where to paste it, and — since Phase 3
 * — what happened when we actually tried it.
 *
 * Key hygiene rules (SPEC §C step 3) implemented here:
 *  - the field is password-masked by default, with an explicit 显示/隐藏 toggle;
 *  - the clipboard is read ONLY when the paste button is clicked, never polled;
 *  - `sanitizeApiKeyInput` strips edge whitespace / wrapping quotes / a Bearer
 *    prefix and the removal is surfaced as a gentle notice, never a blocker;
 *  - the `sk-` style prefix is a HINT — it never prevents saving;
 *  - the plaintext lives in React state only until the save resolves, then the
 *    state is cleared and the card shows 「已配置」plus the main-side hint.
 *
 * Test-before-save (Phase 3b): 「保存并测试连接」 sends the candidate key to the
 * main process FIRST and only persists it once every probe came back OK. A
 * failure leaves the key unsaved and in the input, so 「重新填写」 is a real
 * option — with 「暂时保存并稍后重试」 as the deliberate escape hatch for a
 * provider that is merely down right now.
 */
import { useRef, useState, type ReactNode } from 'react';
import { sanitizeApiKeyInput } from '../../../shared/keyInput';
import { candidateKeyTest, type EndpointTarget } from '../../../shared/providerTestRequests';
import type { ProviderPreset } from '../../../shared/providerCatalog';
import type { ProviderTestRequest, ProviderTestResult, UiLang } from '../../../shared/protocol';
import { ConnectionResult } from '../../components/providers/ConnectionResult';
import { connectionResultCopy } from '../connectionCopy';
import type { SetupDict } from '../i18n';

type NoticeKind = 'info' | 'ok' | 'warn' | 'err';
interface Notice {
  kind: NoticeKind;
  text: string;
}

const NOTICE_CLASS: Record<NoticeKind, string> = {
  info: 'key-notice',
  ok: 'key-notice key-notice-ok',
  warn: 'key-notice key-notice-warn',
  err: 'key-notice key-notice-err',
};

/** one probe this card runs; more than one = a single key serving two services */
export interface CardTest {
  id: string;
  /** row label, only rendered when the card runs several probes */
  label?: string;
  target: EndpointTarget;
}

interface ProbeOutcome {
  id: string;
  label?: string;
  result: ProviderTestResult;
  at: number;
}

export interface ApiKeyCardProps {
  title: string;
  preset: ProviderPreset;
  /** a key is already stored for this slot */
  configured: boolean;
  /** last <=4 chars of the stored key (may be absent for migrated profiles) */
  hint?: string;
  t: SetupDict;
  lang: UiLang;
  /** overrides the catalog preset name (one card standing for two slots) */
  name?: string;
  description?: string;
  /** the OS credential store is unavailable: confirm before persisting a key */
  weakCrypto: boolean;
  /** probes run in order, sequentially, against the SAME candidate key */
  tests: CardTest[];
  /** one real provider round-trip; never throws for a provider-side failure */
  runTest: (req: ProviderTestRequest) => Promise<ProviderTestResult>;
  /** persists the sanitized plaintext; rejects with a message on failure */
  onSave: (apiKey: string) => Promise<void>;
  /** the user chose 暂时保存并稍后重试 — saved, but no passing test behind it */
  onSavedUntested?: () => void;
  onOpenExternal: (url: string) => Promise<boolean>;
  onReadClipboard: () => Promise<string>;
  /** extra controls rendered under the header (e.g. the shared-key checkbox) */
  children?: ReactNode;
}

export function ApiKeyCard({
  title,
  preset,
  configured,
  hint,
  t,
  lang,
  name: nameOverride,
  description: descriptionOverride,
  weakCrypto,
  tests,
  runTest,
  onSave,
  onSavedUntested,
  onOpenExternal,
  onReadClipboard,
  children,
}: ApiKeyCardProps) {
  const [value, setValue] = useState('');
  const [reveal, setReveal] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [tutorial, setTutorial] = useState(false);
  /** the weak-crypto confirmation is pending; nothing has been persisted yet */
  const [confirmWeak, setConfirmWeak] = useState(false);
  /** id of the probe currently in flight */
  const [running, setRunning] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<ProbeOutcome[]>([]);
  /** the sanitized key whose test failed — kept so 暂时保存 can still store it */
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const help = preset.help;
  const steps = lang === 'zh' ? help.stepsZh : help.stepsEn;
  const faq = lang === 'zh' ? help.faqZh : help.faqEn;
  const billing = lang === 'zh' ? help.billingHintZh : help.billingHintEn;
  const name = nameOverride ?? (lang === 'zh' ? preset.nameZh : preset.nameEn);
  const description =
    descriptionOverride ?? (lang === 'zh' ? preset.descriptionZh : preset.descriptionEn);
  const copy = connectionResultCopy(t);

  /** turns the sanitizer's warning list into one 「已自动去除…」 notice */
  const sanitizeNotices = (warnings: readonly string[]): Notice[] => {
    if (warnings.length === 0) return [];
    const parts = warnings.map(
      (w) => t.provider.sanitizedParts[w as keyof typeof t.provider.sanitizedParts],
    );
    const joined = lang === 'zh' ? parts.join('、') : parts.join(', ');
    return [{ kind: 'info', text: t.provider.sanitized(joined) }];
  };

  const openLink = async (url: string | undefined) => {
    if (!url) return;
    const ok = await onOpenExternal(url);
    if (!ok) setNotices([{ kind: 'err', text: t.provider.linkFail }]);
  };

  const paste = async () => {
    try {
      const raw = await onReadClipboard();
      if (!raw.trim()) {
        setNotices([{ kind: 'warn', text: t.provider.clipboardEmpty }]);
        return;
      }
      const clean = sanitizeApiKeyInput(raw);
      setValue(clean.value);
      setNotices(sanitizeNotices(clean.warnings));
    } catch (e) {
      setNotices([{ kind: 'err', text: t.provider.clipboardFail((e as Error).message) }]);
    }
  };

  /**
   * Pre-flight, not post-hoc: on a machine without OS credential storage the
   * user is asked BEFORE the plaintext leaves the renderer, so 「返回」 really
   * means the key was never persisted.
   */
  const requestSave = () => {
    if (!sanitizeApiKeyInput(value).value) {
      setNotices([{ kind: 'warn', text: t.provider.emptyKey }]);
      return;
    }
    if (weakCrypto) {
      setConfirmWeak(true);
      return;
    }
    void saveAndTest();
  };

  /** the only place a plaintext key is handed to the main process */
  const persist = async (apiKey: string, base: Notice[], untested: boolean) => {
    setBusy(true);
    try {
      await onSave(apiKey);
      // the plaintext never outlives the save
      setValue('');
      setReveal(false);
      setEditing(false);
      setFailedKey(null);
      if (untested) onSavedUntested?.();
      setNotices([
        ...base,
        untested
          ? { kind: 'warn', text: t.provider.savedUntested }
          : { kind: 'ok', text: t.provider.savedOk },
      ]);
    } catch (e) {
      setNotices([...base, { kind: 'err', text: t.provider.saveFail((e as Error).message) }]);
    } finally {
      setBusy(false);
    }
  };

  /**
   * Probes run one after another on purpose: the mimo-simple plan tests ONE
   * freshly created key against two services, and two parallel first requests
   * are a reliable way to collect a rate-limit instead of a verdict.
   */
  const saveAndTest = async () => {
    setConfirmWeak(false);
    const clean = sanitizeApiKeyInput(value);
    if (!clean.value) {
      setNotices([{ kind: 'warn', text: t.provider.emptyKey }]);
      return;
    }
    const base = sanitizeNotices(clean.warnings);
    if (help.keyFormatHint && !clean.value.startsWith(help.keyFormatHint)) {
      base.push({ kind: 'warn', text: t.provider.prefixHint(help.keyFormatHint) });
    }
    setNotices(base);
    setOutcomes([]);
    setFailedKey(null);
    setBusy(true);

    const collected: ProbeOutcome[] = [];
    try {
      for (const probe of tests) {
        setRunning(probe.id);
        const result = await runTest(candidateKeyTest(probe.target, clean.value));
        collected.push({ id: probe.id, label: probe.label, result, at: Date.now() });
        setOutcomes([...collected]);
      }
    } catch (e) {
      // the IPC itself failed (the provider's own failures come back as a result)
      setRunning(null);
      setBusy(false);
      setFailedKey(clean.value);
      setNotices([...base, { kind: 'err', text: t.provider.testCrashed((e as Error).message) }]);
      return;
    }
    setRunning(null);

    if (collected.every((o) => o.result.ok)) {
      await persist(clean.value, base, false);
      return;
    }
    setFailedKey(clean.value);
    setBusy(false);
  };

  const showInput = !configured || editing;
  const multi = tests.length > 1;
  /** rows for probes that have not produced a verdict yet, so a dual test shows
   * both services from the first click instead of popping a second row later */
  const rows: (ProbeOutcome | { id: string; label?: string; result: null; at?: number })[] =
    tests.map((probe) => outcomes.find((o) => o.id === probe.id) ?? { ...probe, result: null });
  /** the recovery buttons belong to the run, not to each row — a dual test that
   * fails twice must not offer 「暂时保存」 twice */
  const firstFailedId = rows.find((r) => r.result && !r.result.ok)?.id;

  return (
    <section className="setup-card">
      <div className="key-card-head">
        <div>
          <div className="setup-card-title">{title}</div>
          <div className="key-card-name">{name}</div>
          <div className="key-card-desc">{description}</div>
        </div>
        <span className={configured ? 'tag tag-ok' : 'tag'}>
          {configured ? t.provider.configured : t.provider.notConfigured}
        </span>
      </div>

      {children}

      <div className="key-section">
        <div className="key-section-title">{t.provider.getKeyTitle}</div>
        <div className="key-actions">
          {help.keyUrl && (
            <button className="btn btn-sm" onClick={() => void openLink(help.keyUrl)}>
              {t.provider.openKeyPage}
            </button>
          )}
          {help.docsUrl && (
            <button className="btn btn-sm" onClick={() => void openLink(help.docsUrl)}>
              {t.provider.openDocs}
            </button>
          )}
          <button className="btn btn-sm" onClick={() => setTutorial((v) => !v)}>
            {tutorial ? t.provider.hideTutorial : t.provider.showTutorial}
          </button>
        </div>
        {tutorial && (
          <div className="key-tutorial">
            <ol>
              {steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
            {faq && faq.length > 0 && (
              <>
                <div className="key-section-title" style={{ marginTop: 10 }}>
                  {t.provider.faqTitle}
                </div>
                <ul className="setup-list">
                  {faq.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              </>
            )}
            {billing && <div className="key-hint">{billing}</div>}
          </div>
        )}
      </div>

      <div className="key-section">
        <div className="key-section-title">{t.provider.pasteTitle}</div>
        {showInput ? (
          <>
            <div className="key-input-row">
              <input
                ref={inputRef}
                className="setup-input"
                type={reveal ? 'text' : 'password'}
                value={value}
                spellCheck={false}
                autoComplete="off"
                placeholder={t.provider.inputPlaceholder}
                onChange={(e) => setValue(e.target.value)}
              />
              <button className="btn btn-sm" onClick={() => setReveal((v) => !v)}>
                {reveal ? t.provider.hide : t.provider.show}
              </button>
              <button className="btn btn-sm" onClick={() => void paste()}>
                {t.provider.pasteFromClipboard}
              </button>
            </div>
            <div className="key-hint">{t.provider.encHint}</div>
            {confirmWeak && (
              <div className="key-notice key-notice-warn">
                <div>{t.provider.weakCryptoWarning}</div>
                <div className="key-actions" style={{ marginTop: 8 }}>
                  <button className="btn btn-sm" onClick={() => setConfirmWeak(false)}>
                    {t.provider.weakCryptoBack}
                  </button>
                  <button className="btn btn-sm" onClick={() => void saveAndTest()}>
                    {t.provider.weakCryptoContinue}
                  </button>
                </div>
              </div>
            )}
            <div className="key-actions" style={{ marginTop: 10 }}>
              <button className="btn btn-primary" disabled={busy} onClick={requestSave}>
                {running ? t.provider.testing : busy ? t.provider.saving : t.provider.saveAndTest}
              </button>
              {configured && (
                <button
                  className="btn"
                  onClick={() => {
                    setEditing(false);
                    setValue('');
                    setNotices([]);
                    setConfirmWeak(false);
                    setFailedKey(null);
                  }}
                >
                  {t.provider.cancelReplace}
                </button>
              )}
            </div>
            <div className="key-hint">{t.provider.feeNote}</div>
          </>
        ) : (
          <div className="key-saved-row">
            <span className="tag tag-ok">{t.provider.configured}</span>
            {hint && <span className="key-mask">{`••••${hint}`}</span>}
            <button
              className="btn btn-sm"
              onClick={() => {
                setEditing(true);
                setNotices([]);
                setOutcomes([]);
                setFailedKey(null);
              }}
            >
              {t.provider.replaceKey}
            </button>
          </div>
        )}

        {rows.map((row) => (
          <ConnectionResult
            key={row.id}
            copy={copy}
            label={multi ? row.label : undefined}
            result={row.result}
            testing={running === row.id}
            message={
              row.result ? (lang === 'zh' ? row.result.messageZh : row.result.messageEn) : undefined
            }
            hint={row.result ? t.provider.actionHints[row.result.code] : undefined}
            at={row.at}
          >
            {row.id === firstFailedId && (
              <>
                <button
                  className="btn btn-sm"
                  onClick={() => {
                    setEditing(true);
                    window.setTimeout(() => inputRef.current?.focus(), 0);
                  }}
                >
                  {t.provider.retryEdit}
                </button>
                {help.keyUrl && (
                  <button className="btn btn-sm" onClick={() => void openLink(help.keyUrl)}>
                    {t.provider.openKeyPage}
                  </button>
                )}
                {failedKey && (
                  <button
                    className="btn btn-sm"
                    disabled={busy}
                    onClick={() => void persist(failedKey, [], true)}
                  >
                    {t.provider.saveUntested}
                  </button>
                )}
              </>
            )}
          </ConnectionResult>
        ))}

        {notices.map((n, i) => (
          <div key={`${n.kind}-${i}`} className={NOTICE_CLASS[n.kind]}>
            {n.text}
          </div>
        ))}
      </div>
    </section>
  );
}
