/** Transport failures are typed; callers must not replay paid generation automatically. */
export class LlmRequestError extends Error {
  constructor(
    readonly code: 'TIMEOUT' | 'CANCELLED' | 'NETWORK_ERROR' | 'HTTP_ERROR' | 'INVALID_RESPONSE',
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = code === 'TIMEOUT' ? 'TimeoutError' : code === 'CANCELLED' ? 'AbortError' : 'LlmRequestError';
  }
}

/** A bounded lifetime including response-body consumption, not only connection. */
export function requestLifetime(signal?: AbortSignal, timeoutMs = 60_000) {
  const controller = new AbortController();
  const cancel = () => controller.abort(new LlmRequestError('CANCELLED', 'Request cancelled'));
  if (signal?.aborted) cancel();
  else signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => controller.abort(
    new LlmRequestError('TIMEOUT', 'Provider request timed out; check the network or choose a faster model'),
  ), timeoutMs);
  return {
    signal: controller.signal,
    dispose() { clearTimeout(timer); signal?.removeEventListener('abort', cancel); },
  };
}
