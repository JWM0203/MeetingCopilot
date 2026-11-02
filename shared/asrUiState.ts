import type { AsrEvent } from './protocol';

export type ErrorSource = 'engine' | 'capture' | 'mic';
export interface AsrUiState {
  phase: 'loading' | 'ready' | 'error';
  ep?: string;
  gpuSuspect?: boolean;
  workerState: 'loading' | 'listening' | 'speech' | 'transcribing' | 'stopped';
  lastError?: string;
  errorSource?: ErrorSource;
  errors?: Partial<Record<ErrorSource, string>>;
}

function errorsOf(state: AsrUiState): Partial<Record<ErrorSource, string>> {
  return { ...(state.lastError && state.errorSource ? { [state.errorSource]: state.lastError } : {}), ...state.errors };
}

export function setError(state: AsrUiState, source: ErrorSource, message: string): AsrUiState {
  return { ...state, errors: { ...errorsOf(state), [source]: message }, lastError: message, errorSource: source };
}

export function clearError(state: AsrUiState, source: ErrorSource): AsrUiState {
  const errors = errorsOf(state);
  delete errors[source];
  const remaining = state.errorSource !== source && state.errorSource && errors[state.errorSource]
    ? state.errorSource : (['capture', 'mic', 'engine'] as const).find((key) => errors[key]);
  return { ...state, errors, lastError: remaining ? errors[remaining] : undefined, errorSource: remaining };
}

export function updateAsrUiState(state: AsrUiState, event: AsrEvent): AsrUiState {
  switch (event.kind) {
    case 'ready':
      return { ...clearError(state, 'engine'), phase: 'ready', ep: event.ep, gpuSuspect: event.gpuSuspect, workerState: 'listening' };
    case 'status':
      return { ...state, workerState: event.state };
    case 'error':
      return { ...setError(state, 'engine', event.message), phase: event.fatal ? 'error' : state.phase };
    case 'partial':
    case 'segment':
      // Actual transcription proves a nonfatal engine error has recovered.
      return state.phase === 'ready' && event.text.trim() ? clearError(state, 'engine') : state;
  }
}
