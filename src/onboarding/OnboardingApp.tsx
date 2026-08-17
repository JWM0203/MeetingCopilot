/**
 * Onboarding wizard shell — PHASE 2a STUB.
 *
 * Phase 2b replaces the body of this component with the real 5-step wizard
 * (`src/onboarding/steps/*.tsx`) and moves every string into a typed zh/en
 * dictionary. What must survive that rewrite is what this stub proves:
 *   - src/setup.html builds and loads inside the packaged app;
 *   - the dedicated setup preload exposes window.mcSetup;
 *   - appGetInfo / onboardingGet / onboardingComplete round-trip over IPC;
 *   - shared/providerCatalog.ts is importable from the renderer.
 *
 * The copy below is deliberately temporary and NOT in the i18n dictionaries.
 */
import { useEffect, useState } from 'react';
import type { AppInfo, OnboardingState } from '../../shared/protocol';
import { PROVIDER_PRESETS } from '../../shared/providerCatalog';

const page: React.CSSProperties = {
  minHeight: '100vh',
  margin: 0,
  padding: '32px 40px',
  background: '#161a22',
  color: '#e8eaf0',
  font: "14px/1.7 'Microsoft YaHei', system-ui, sans-serif",
};
const card: React.CSSProperties = {
  marginTop: 20,
  padding: '16px 18px',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 10,
  background: 'rgba(255,255,255,0.04)',
};
const label: React.CSSProperties = { color: '#8b95ab', marginRight: 8 };
const button: React.CSSProperties = {
  marginTop: 24,
  padding: '10px 22px',
  border: 'none',
  borderRadius: 8,
  background: '#2a6df4',
  color: '#fff',
  font: "600 14px 'Microsoft YaHei', system-ui, sans-serif",
  cursor: 'pointer',
};

export function OnboardingApp() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [onboarding, setOnboarding] = useState<OnboardingState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const [a, o] = await Promise.all([
          window.mcSetup.getAppInfo(),
          window.mcSetup.getOnboarding(),
        ]);
        if (!alive) return;
        setInfo(a);
        setOnboarding(o);
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const complete = async () => {
    setBusy(true);
    try {
      // no plan is claimed: the stub configures nothing, it only unblocks boot
      setOnboarding(await window.mcSetup.completeOnboarding({}));
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const recommended = PROVIDER_PRESETS.filter((p) => p.recommended);

  return (
    <div style={page}>
      <h1 style={{ font: "600 22px 'Microsoft YaHei', system-ui, sans-serif" }}>MeetingCopilot</h1>
      <p style={{ color: '#8b95ab', marginTop: 6 }}>
        配置向导（开发占位页面，第 2b 阶段将替换为完整的 5 步向导）。
      </p>

      {error && (
        <div style={{ ...card, borderColor: '#c04a4a', color: '#ffb4b4' }}>IPC 调用失败：{error}</div>
      )}

      <div style={card}>
        <div>
          <span style={label}>版本</span>
          {info ? `${info.version}（${info.platform}${info.packaged ? '，已打包' : '，开发模式'}）` : '读取中…'}
        </div>
        <div>
          <span style={label}>向导状态</span>
          {onboarding
            ? `completed=${String(onboarding.completed)}${
                onboarding.selectedPlan ? `，plan=${onboarding.selectedPlan}` : ''
              }`
            : '读取中…'}
        </div>
      </div>

      <div style={card}>
        <div style={{ color: '#8b95ab', marginBottom: 6 }}>推荐方案（来自服务商目录）</div>
        {recommended.map((p) => (
          <div key={p.id}>
            {p.nameZh} <span style={{ color: '#6d7689' }}>· {p.id}</span>
          </div>
        ))}
      </div>

      <button style={button} onClick={complete} disabled={busy || !onboarding}>
        {busy ? '正在进入…' : '完成配置'}
      </button>
    </div>
  );
}
