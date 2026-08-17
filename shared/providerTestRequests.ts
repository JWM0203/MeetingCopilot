/**
 * Request builders for provider connection tests (Phase 3b).
 *
 * The wizard and the settings panel both have to turn "this preset, that slot,
 * this key" into a {@link ProviderTestRequest}. Doing it inline in two React
 * components is how the two surfaces drift apart — and a drifted request is not
 * a cosmetic bug: sending a candidate key without a slot silently skips the
 * verification record, and sending `useStoredKey` without a slot makes the main
 * process test with an empty key (see electron/providerTest.ts).
 *
 * Pure data + pure functions (no React, no electron), so `test/` can assert the
 * exact wire shape both surfaces produce.
 */
import type { ProviderSlot, ProviderTestRequest } from './protocol';
import type { ProviderCapability, ProviderId, ProviderPreset } from './providerCatalog';

/** everything a test needs to know about WHERE it is connecting */
export interface EndpointTarget {
  capability: ProviderCapability;
  providerId: ProviderId;
  baseUrl: string;
  model: string;
  /** which stored key/verification slot this endpoint belongs to */
  slot: ProviderSlot;
  /** catalog preset id when the endpoint came from the catalog */
  presetId?: string;
  /** vision only: '127.0.0.1:7897'-style local proxy */
  proxyUrl?: string;
}

/** catalog preset -> target for the given credential slot */
export function targetFromPreset(preset: ProviderPreset, slot: ProviderSlot): EndpointTarget {
  return {
    capability: preset.capability,
    providerId: preset.providerId,
    baseUrl: preset.baseUrl,
    model: preset.model,
    slot,
    presetId: preset.id,
    ...(preset.defaultProxyUrl ? { proxyUrl: preset.defaultProxyUrl } : {}),
  };
}

/**
 * A target is only worth a round-trip once it points somewhere: an empty base
 * URL or model would burn a request just to come back as MODEL_NOT_FOUND.
 */
export function isTestableTarget(target: EndpointTarget): boolean {
  return target.baseUrl.trim() !== '' && target.model.trim() !== '';
}

/** test a key the user just typed, BEFORE it is saved anywhere */
export function candidateKeyTest(target: EndpointTarget, apiKey: string): ProviderTestRequest {
  return { ...baseRequest(target), candidateApiKey: apiKey };
}

/**
 * Test the key already stored in the slot. `useStoredKey` without `slot` is a
 * no-op main-side, so the two always travel together here.
 */
export function storedKeyTest(target: EndpointTarget): ProviderTestRequest {
  return { ...baseRequest(target), useStoredKey: true };
}

function baseRequest(target: EndpointTarget): ProviderTestRequest {
  return {
    capability: target.capability,
    providerId: target.providerId,
    baseUrl: target.baseUrl.trim(),
    model: target.model.trim(),
    slot: target.slot,
    ...(target.presetId ? { presetId: target.presetId } : {}),
    ...(target.proxyUrl ? { proxyUrl: target.proxyUrl } : {}),
  };
}

/**
 * Execution order for a card that runs more than one probe (the mimo-simple
 * plan tests ONE key against two capabilities).
 *
 * Cheapest and most diagnostic first: a 1-token chat completion answers "is
 * this key real" in ~300 ms, so when it fails the audio round-trip that follows
 * is already explained. The probes are also run SEQUENTIALLY by the caller —
 * two first-requests fired in parallel on a freshly minted key is a good way to
 * collect a rate-limit instead of a verdict.
 */
const CAPABILITY_ORDER: readonly ProviderCapability[] = [
  'text-llm',
  'asr-segment',
  'asr-realtime',
  'vision',
];

export function orderTestTargets(targets: readonly EndpointTarget[]): EndpointTarget[] {
  return [...targets].sort(
    (a, b) => CAPABILITY_ORDER.indexOf(a.capability) - CAPABILITY_ORDER.indexOf(b.capability),
  );
}
