/**
 * Adapter between the wizard dictionary and the shared ConnectionResult
 * component, which takes copy as props so it can be used from both renderer
 * entries (see src/components/providers/ConnectionResult.tsx).
 */
import type { ConnectionResultCopy } from '../components/providers/ConnectionResult';
import type { SetupDict } from './i18n';

export function connectionResultCopy(t: SetupDict): ConnectionResultCopy {
  return {
    locale: t.locale,
    testing: t.provider.testing,
    success: t.provider.testSuccess,
    failed: t.provider.testFailed,
    hintLabel: t.provider.hintLabel,
    retryableNote: t.provider.retryableNote,
    detailShow: t.provider.detailShow,
    detailHide: t.provider.detailHide,
    detailCode: t.provider.detailCode,
    detailRequestId: t.provider.detailRequestId,
    detailTime: t.provider.detailTime,
  };
}
