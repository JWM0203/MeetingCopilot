/**
 * Adapter between the main-window dictionary and the shared ConnectionResult
 * component (the wizard has its own in src/onboarding/connectionCopy.ts —
 * neither renderer entry may import the other's dictionary).
 */
import type { Dict } from '../../i18n';
import type { ConnectionResultCopy } from './ConnectionResult';

export function connectionResultCopy(t: Dict): ConnectionResultCopy {
  return {
    locale: t.locale,
    testing: t.settings.testing,
    success: t.settings.testSuccessTag,
    failed: t.settings.testFailedTag,
    hintLabel: t.settings.testHintLabel,
    retryableNote: t.settings.testRetryable,
    detailShow: t.settings.testDetailShow,
    detailHide: t.settings.testDetailHide,
    detailCode: t.settings.testDetailCode,
    detailRequestId: t.settings.testDetailRequestId,
    detailTime: t.settings.testDetailTime,
  };
}
