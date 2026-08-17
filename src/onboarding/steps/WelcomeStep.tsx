/** Step 1 欢迎 — what BYOK means, what an API key is, and what leaves the machine. */
import { useState } from 'react';
import type { SetupDict } from '../i18n';

export function WelcomeStep({ t }: { t: SetupDict }) {
  const [explain, setExplain] = useState(false);

  return (
    <div>
      <h1 className="setup-h1">{t.welcome.title}</h1>
      <p className="setup-lead">{t.welcome.body}</p>

      <section className="setup-card">
        <div className="setup-card-title">{t.welcome.byokTitle}</div>
        <p style={{ color: 'var(--text-body)' }}>{t.welcome.byokBody}</p>
        <button className="btn-link" style={{ marginTop: 8 }} onClick={() => setExplain((v) => !v)}>
          {explain ? `▾ ${t.welcome.keyExplainTitle}` : `▸ ${t.welcome.keyExplainTitle}`}
        </button>
        {explain && <p className="key-tutorial">{t.welcome.keyExplainBody}</p>}
      </section>

      <section className="setup-card">
        <div className="setup-card-title">{t.welcome.privacyTitle}</div>
        <ul className="setup-list">
          {t.welcome.privacy.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>

      <p className="setup-footnote">{t.welcome.footnote}</p>
    </div>
  );
}
