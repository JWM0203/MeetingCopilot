/**
 * One provider = one card: where to get the key (official page + an inline
 * step-by-step guide from the catalog) and where to paste it.
 *
 * Key hygiene rules (SPEC §C step 3) implemented here:
 *  - the field is password-masked by default, with an explicit 显示/隐藏 toggle;
 *  - the clipboard is read ONLY when the paste button is clicked, never polled;
 *  - `sanitizeApiKeyInput` strips edge whitespace / wrapping quotes / a Bearer
 *    prefix and the removal is surfaced as a gentle notice, never a blocker;
 *  - the `sk-` style prefix is a HINT — it never prevents saving;
 *  - the plaintext lives in React state only until the save resolves, then the
 *    state is cleared and the card shows 「已配置」plus the main-side hint.
 */
import { useState, type ReactNode } from 'react';
import { sanitizeApiKeyInput } from '../../../shared/keyInput';
import type { ProviderPreset } from '../../../shared/providerCatalog';
import type { UiLang } from '../../../shared/protocol';
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
  /** persists the sanitized plaintext; rejects with a message on failure */
  onSave: (apiKey: string) => Promise<void>;
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
  onSave,
  onOpenExternal,
  onReadClipboard,
  children,
}: ApiKeyCardProps) {
  const [value, setValue] = useState('');
  const [reveal, setReveal] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [justSaved, setJustSaved] = useState(false);
  const [tutorial, setTutorial] = useState(false);

  const help = preset.help;
  const steps = lang === 'zh' ? help.stepsZh : help.stepsEn;
  const faq = lang === 'zh' ? help.faqZh : help.faqEn;
  const billing = lang === 'zh' ? help.billingHintZh : help.billingHintEn;
  const name = nameOverride ?? (lang === 'zh' ? preset.nameZh : preset.nameEn);
  const description =
    descriptionOverride ?? (lang === 'zh' ? preset.descriptionZh : preset.descriptionEn);

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

  const save = async () => {
    const clean = sanitizeApiKeyInput(value);
    if (!clean.value) {
      setNotices([{ kind: 'warn', text: t.provider.emptyKey }]);
      return;
    }
    const next = sanitizeNotices(clean.warnings);
    if (help.keyFormatHint && !clean.value.startsWith(help.keyFormatHint)) {
      next.push({ kind: 'warn', text: t.provider.prefixHint(help.keyFormatHint) });
    }
    setBusy(true);
    try {
      await onSave(clean.value);
      // the plaintext never outlives the save
      setValue('');
      setReveal(false);
      setEditing(false);
      setJustSaved(true);
      next.push({ kind: 'ok', text: t.provider.savedPending });
      setNotices(next);
    } catch (e) {
      setNotices([...next, { kind: 'err', text: t.provider.saveFail((e as Error).message) }]);
    } finally {
      setBusy(false);
    }
  };

  const showInput = !configured || editing;

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
            <div className="key-actions" style={{ marginTop: 10 }}>
              <button className="btn btn-primary" disabled={busy} onClick={() => void save()}>
                {busy ? t.provider.saving : t.provider.saveAndTest}
              </button>
              {configured && (
                <button
                  className="btn"
                  onClick={() => {
                    setEditing(false);
                    setValue('');
                    setNotices([]);
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
                setJustSaved(false);
                setNotices([]);
              }}
            >
              {t.provider.replaceKey}
            </button>
          </div>
        )}
        {justSaved && !showInput && notices.length === 0 && (
          <div className={NOTICE_CLASS.ok}>{t.provider.savedPending}</div>
        )}
        {notices.map((n, i) => (
          <div key={`${n.kind}-${i}`} className={NOTICE_CLASS[n.kind]}>
            {n.text}
          </div>
        ))}
      </div>
    </section>
  );
}
