/**
 * Step 3 服务配置 — one ApiKeyCard per slot the chosen plan needs.
 *
 * The 「极简配置」plan with the reuse checkbox renders ONE card whose save
 * writes the same plaintext into both slots in a SINGLE settings patch, so the
 * two ciphertexts are produced independently and no shared plaintext copy is
 * ever kept in the renderer. That card also runs TWO connection tests with the
 * same candidate key (text LLM first, then segment ASR) and only saves when
 * both came back OK — one key that only half works is exactly the failure this
 * plan is prone to.
 */
import { ApiKeyCard, type CardTest } from '../components/ApiKeyCard';
import { planDefinition, type KeySlot } from '../../../shared/onboardingPlans';
import { orderTestTargets, targetFromPreset } from '../../../shared/providerTestRequests';
import type {
  OnboardingPlan,
  ProviderSlot,
  ProviderTestRequest,
  ProviderTestResult,
  PublicSettings,
  UiLang,
} from '../../../shared/protocol';
import type { SetupDict } from '../i18n';

export interface ProviderStepProps {
  t: SetupDict;
  lang: UiLang;
  plan: OnboardingPlan;
  shareMimoKey: boolean;
  settings: PublicSettings;
  /** writes the key into every listed slot with one settings patch */
  onSaveKey: (slots: KeySlot[], apiKey: string) => Promise<void>;
  /** one real provider round-trip (window.mcSetup.providerTest) */
  onTest: (req: ProviderTestRequest) => Promise<ProviderTestResult>;
  /** 暂时保存并稍后重试: the slots hold a key nothing has verified */
  onSavedUntested: (slots: KeySlot[]) => void;
  onOpenExternal: (url: string) => Promise<boolean>;
  onReadClipboard: () => Promise<string>;
}

export function slotState(
  settings: PublicSettings,
  slot: KeySlot,
): { configured: boolean; hint?: string } {
  switch (slot) {
    case 'llm':
      return { configured: settings.llm.apiKeySet, hint: settings.llm.apiKeyHint };
    case 'asr-cloud':
      return { configured: settings.asr.cloud.apiKeySet, hint: settings.asr.cloud.apiKeyHint };
    case 'asr-realtime':
    default:
      return { configured: settings.asr.realtime.apiKeySet, hint: settings.asr.realtime.apiKeyHint };
  }
}

export function ProviderStep({
  t,
  lang,
  plan,
  shareMimoKey,
  settings,
  onSaveKey,
  onTest,
  onSavedUntested,
  onOpenExternal,
  onReadClipboard,
}: ProviderStepProps) {
  const def = planDefinition(plan);
  const shared = def.canShareKey && shareMimoKey && !!def.asr && !!def.llm;

  const subtitle =
    plan === 'mimo-simple'
      ? t.provider.subtitleMimo
      : plan === 'transcription-only'
        ? t.provider.subtitleTranscription
        : t.provider.subtitleRecommended;

  const labelForSlot = (slot: ProviderSlot): string =>
    slot === 'llm' ? t.provider.rowLlmTest : t.provider.rowAsrTest;

  /** probes for one card, in the order they should be run */
  const testsFor = (slots: KeySlot[]): CardTest[] =>
    orderTestTargets(
      slots.map((slot) => targetFromPreset(slot === 'llm' ? def.llm!.preset : def.asr!.preset, slot)),
    ).map((target) => ({ id: target.slot, label: labelForSlot(target.slot), target }));

  return (
    <div>
      <h1 className="setup-h1">{t.provider.title}</h1>
      <p className="setup-sub">{subtitle}</p>

      {shared && def.asr && def.llm ? (
        <ApiKeyCard
          title={t.provider.sharedCardTitle}
          preset={def.llm.preset}
          name={t.provider.sharedCardName}
          description={t.provider.sharedCardDesc}
          configured={
            slotState(settings, def.asr.slot).configured &&
            slotState(settings, def.llm.slot).configured
          }
          hint={slotState(settings, def.llm.slot).hint}
          t={t}
          lang={lang}
          weakCrypto={settings.weakCrypto}
          tests={testsFor([def.llm.slot, def.asr.slot])}
          runTest={onTest}
          onSave={(key) => onSaveKey([def.asr!.slot, def.llm!.slot], key)}
          onSavedUntested={() => onSavedUntested([def.asr!.slot, def.llm!.slot])}
          onOpenExternal={onOpenExternal}
          onReadClipboard={onReadClipboard}
        />
      ) : (
        <>
          {def.asr && (
            <ApiKeyCard
              title={t.provider.asrCardTitle}
              preset={def.asr.preset}
              {...slotState(settings, def.asr.slot)}
              t={t}
              lang={lang}
              weakCrypto={settings.weakCrypto}
              tests={testsFor([def.asr.slot])}
              runTest={onTest}
              onSave={(key) => onSaveKey([def.asr!.slot], key)}
              onSavedUntested={() => onSavedUntested([def.asr!.slot])}
              onOpenExternal={onOpenExternal}
              onReadClipboard={onReadClipboard}
            />
          )}
          {def.llm && (
            <ApiKeyCard
              title={t.provider.llmCardTitle}
              preset={def.llm.preset}
              {...slotState(settings, def.llm.slot)}
              t={t}
              lang={lang}
              weakCrypto={settings.weakCrypto}
              tests={testsFor([def.llm.slot])}
              runTest={onTest}
              onSave={(key) => onSaveKey([def.llm!.slot], key)}
              onSavedUntested={() => onSavedUntested([def.llm!.slot])}
              onOpenExternal={onOpenExternal}
              onReadClipboard={onReadClipboard}
            />
          )}
        </>
      )}
    </div>
  );
}
