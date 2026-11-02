import { useT } from '../i18n';
import { hintProps } from '../surfaceHints';
export function ProtectionPreference({ actual, nextLaunch, busy, onToggle }: {
  actual: boolean | null; nextLaunch: boolean; busy: boolean; onToggle: () => void;
}) {
  const t = useT();
  return <>
    <span className="protection-current">{t.titlebar.protectionCurrent(actual)}</span>
    <button className="btn protection-next" disabled={busy} aria-pressed={nextLaunch} onClick={onToggle}
      {...hintProps(t.titlebar.protectionNextHint)}>{t.titlebar.protectionNext(nextLaunch)}</button>
    {actual !== null && actual !== nextLaunch && <span className="protection-pending">{t.titlebar.protectionPending}</span>}
  </>;
}
