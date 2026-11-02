import { describe, expect, it } from 'vitest';
import { clearError, setError, updateAsrUiState, type AsrUiState } from '../shared/asrUiState';

const ready: AsrUiState = { phase: 'ready', workerState: 'listening' };
const readyEvent = { kind: 'ready' as const, ep: 'cpu', gpuSuspect: false, loadMs: 0, warmMs: 0 };

describe('ASR warning recovery', () => {
  it('clears a recovered fatal engine error when the engine becomes ready', () => {
    const failed = updateAsrUiState(ready, { kind: 'error', message: 'connection lost', fatal: true });
    expect(failed.phase).toBe('error');
    const recovered = updateAsrUiState(failed, readyEvent);
    expect(recovered.phase).toBe('ready');
    expect(recovered.lastError).toBeUndefined();
  });

  it('keeps a nonfatal engine error through a status event but clears it on transcription', () => {
    const failed = updateAsrUiState(ready, { kind: 'error', message: 'temporary failure', fatal: false });
    const status = updateAsrUiState(failed, { kind: 'status', state: 'listening', queuedSegments: 0 });
    expect(status.lastError).toBe('temporary failure');
    expect(updateAsrUiState(status, { kind: 'partial', speaker: 'them', text: '' }).lastError).toBe('temporary failure');
    expect(updateAsrUiState(status, { kind: 'partial', speaker: 'them', text: 'hello' }).lastError).toBeUndefined();
  });

  it('does not clear capture or microphone errors on unrelated engine recovery', () => {
    for (const errorSource of ['capture', 'mic'] as const) {
      const failed = { ...ready, lastError: 'device failed', errorSource };
      expect(updateAsrUiState(failed, readyEvent).lastError).toBe('device failed');
      expect(clearError(failed, errorSource).lastError).toBeUndefined();
    }
  });
});

it('preserves independent capture failures when a later engine warning recovers', () => {
  const capture = setError(ready, 'capture', 'no audio device');
  const both = updateAsrUiState(capture, { kind: 'error', message: 'temporary engine error', fatal: false });
  const recovered = updateAsrUiState(both, readyEvent);
  expect(recovered.lastError).toBe('no audio device');
  expect(recovered.errorSource).toBe('capture');
  expect(clearError(recovered, 'capture').lastError).toBeUndefined();
});
