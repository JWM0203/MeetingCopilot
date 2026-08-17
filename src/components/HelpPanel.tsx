/**
 * In-app help center (Phase 4, spec §B).
 *
 * Reachable from the tray (帮助与教程), from Settings and — as a link to the
 * same content on GitHub — from the first-run wizard. It is an overlay panel in
 * the main window rather than a separate BrowserWindow: one renderer, one
 * theme, no second preload surface to harden.
 *
 * Everything it shows is LOCAL. The copy lives in the typed zh/en dictionaries
 * (src/i18n.tsx) and the per-provider tutorials are rendered straight from
 * shared/providerCatalog.ts, so the wizard, the settings panel and this page can
 * never disagree about how to get a key. The only network action is an explicit
 * click on a documentation button, which goes through the main-process
 * allowlist (electron/externalLinks.ts).
 */
import { useEffect, useState, type ReactNode } from 'react';
import type { AppInfo } from '../../shared/protocol';
import { PROVIDER_HELP } from '../../shared/providerCatalog';
import { DOCS, docUrl, type LocalizedDoc } from '../../shared/docsLinks';
import { useT } from '../i18n';

/**
 * The providers a user actually has to sign up with. `as const` on purpose:
 * the ids double as keys into the help dictionary, so adding one here without
 * writing zh + en copy for it is a compile error.
 */
const TUTORIAL_PROVIDERS = ['deepseek', 'aliyun-dashscope-cn', 'mimo', 'gemini'] as const;

export function HelpPanel({
  onClose,
  onOpenSettings,
  onOpenDiagnostics,
}: {
  onClose: () => void;
  onOpenSettings?: () => void;
  onOpenDiagnostics?: () => void;
}) {
  const t = useT();
  const lang = t.uiLang;
  const [info, setInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    void window.mc
      .getAppInfo()
      .then(setInfo)
      .catch(() => undefined);
  }, []);

  const open = (doc: LocalizedDoc | string) => void window.mc.openExternal(docUrl(doc, lang));

  const linkButton = (label: string, doc: LocalizedDoc | string) => (
    <button className="btn btn-sm" onClick={() => open(doc)}>
      {label}
    </button>
  );

  /** one collapsible section: bullet copy + the buttons that resolve it */
  const topic = (
    key: string,
    title: string,
    lines: readonly string[],
    actions?: ReactNode,
    extra?: ReactNode,
  ) => (
    <details className="help-topic" key={key}>
      <summary>{title}</summary>
      <div className="help-body">
        <ul className="help-lines">
          {lines.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
        {extra}
        {actions && <div className="help-actions">{actions}</div>}
      </div>
    </details>
  );

  const h = t.help;
  const topics = h.topics;

  /** per-provider tutorial, rendered from the catalog the wizard also uses */
  const providerTutorials = (
    <div className="help-providers">
      {TUTORIAL_PROVIDERS.map((id) => {
        const help = PROVIDER_HELP[id];
        const steps = lang === 'zh' ? help.stepsZh : help.stepsEn;
        const faq = lang === 'zh' ? help.faqZh : help.faqEn;
        const billing = lang === 'zh' ? help.billingHintZh : help.billingHintEn;
        return (
          <div className="help-provider" key={id}>
            <div className="help-provider-name">{h.providerNames[id]}</div>
            <div className="help-sub">{h.steps}</div>
            <ol className="help-lines">
              {steps.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
            {faq && faq.length > 0 && (
              <>
                <div className="help-sub">{h.faq}</div>
                <ul className="help-lines">
                  {faq.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </>
            )}
            {billing && <div className="help-note">{billing}</div>}
            <div className="help-actions">
              {help.keyUrl && (
                <button className="btn btn-sm" onClick={() => void window.mc.openExternal(help.keyUrl!)}>
                  {h.openKeyPage}
                </button>
              )}
              {help.docsUrl && (
                <button
                  className="btn btn-sm"
                  onClick={() => void window.mc.openExternal(help.docsUrl!)}
                >
                  {h.openDocs}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="settings help-panel">
      <div className="settings-section">{h.title}</div>
      <div className="settings-hint">{h.intro}</div>

      {topic(
        'quickStart',
        topics.quickStart.title,
        topics.quickStart.lines,
        linkButton(h.fullGuide, DOCS.quickStart),
      )}

      {topic(
        'apiKey',
        topics.apiKey.title,
        topics.apiKey.lines,
        linkButton(h.fullGuide, DOCS.apiKeys),
      )}

      {topic(
        'providers',
        topics.providers.title,
        topics.providers.lines,
        linkButton(h.fullGuide, DOCS.apiKeys),
        providerTutorials,
      )}

      {topic(
        'noSound',
        topics.noSound.title,
        topics.noSound.lines,
        <>
          {onOpenSettings && (
            <button className="btn btn-sm" onClick={onOpenSettings}>
              {h.openSettings}
            </button>
          )}
          {linkButton(h.fullGuide, DOCS.troubleshooting)}
        </>,
      )}

      {topic(
        'keyErrors',
        topics.keyErrors.title,
        topics.keyErrors.lines,
        <>
          {onOpenSettings && (
            <button className="btn btn-sm" onClick={onOpenSettings}>
              {h.openSettings}
            </button>
          )}
          {linkButton(h.fullGuide, DOCS.troubleshooting)}
        </>,
      )}

      {topic(
        'localAsr',
        topics.localAsr.title,
        topics.localAsr.lines,
        <>
          {linkButton(h.fullGuide, DOCS.windowsSetup)}
          {onOpenDiagnostics && (
            <button className="btn btn-sm" onClick={onOpenDiagnostics}>
              {h.openDiagnostics}
            </button>
          )}
        </>,
      )}

      {topic(
        'windowsSecurity',
        topics.windowsSecurity.title,
        topics.windowsSecurity.lines,
        <>
          {linkButton(h.fullGuide, DOCS.installWindows)}
          {linkButton(h.openReleases, DOCS.releases)}
        </>,
      )}

      {topic(
        'macosAudio',
        topics.macosAudio.title,
        topics.macosAudio.lines,
        <>
          {linkButton(h.fullGuide, DOCS.macosSetup)}
          {linkButton(h.openPage, DOCS.installMacos)}
        </>,
      )}

      {topic(
        'feedback',
        topics.feedback.title,
        topics.feedback.lines,
        <>
          {onOpenDiagnostics && (
            <button className="btn btn-sm" onClick={onOpenDiagnostics}>
              {h.openDiagnostics}
            </button>
          )}
          {linkButton(h.openIssues, DOCS.issues)}
        </>,
      )}

      {topic(
        'about',
        topics.about.title,
        topics.about.lines,
        <>
          {linkButton(h.openRepo, DOCS.repo)}
          {linkButton(h.openReleases, DOCS.releases)}
        </>,
        info && (
          <div className="help-note">
            {h.version(
              info.version,
              `${info.platform} · ${info.packaged ? h.installedBuild : h.devBuild}`,
            )}
          </div>
        ),
      )}

      <div className="settings-actions">
        <button className="btn" onClick={onClose}>
          {h.close}
        </button>
      </div>
    </div>
  );
}
