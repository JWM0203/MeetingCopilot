import { describe, expect, it } from 'vitest';
import { ragActionState } from '../shared/ragUiState';
import type { RagPhase } from '../shared/rag';

describe('ragActionState', () => {
  it('requires a selected folder before enabling', () => {
    expect(ragActionState({ enabled: false, phase: 'disabled' })).toEqual({
      canEnable: false,
      canScan: false,
      canRebuild: false,
      busy: false,
    });
  });

  it.each<RagPhase>(['downloading', 'loading', 'scanning', 'parsing', 'embedding'])(
    'blocks scans and rebuilds while %s',
    (phase) => {
      expect(ragActionState({ enabled: true, rootPath: 'C:\\Knowledge', phase })).toEqual({
        canEnable: true,
        canScan: false,
        canRebuild: false,
        busy: true,
      });
    },
  );

  it('allows scan and rebuild when enabled, configured, and idle', () => {
    expect(
      ragActionState({ enabled: true, rootPath: 'C:\\Knowledge', phase: 'ready' }),
    ).toEqual({ canEnable: true, canScan: true, canRebuild: true, busy: false });
  });

  it('keeps the enable control actionable while an enabled index is busy', () => {
    const state = ragActionState({
      enabled: true,
      rootPath: 'C:\\Knowledge',
      phase: 'embedding',
    });
    expect(state.canEnable).toBe(true);
  });
});
