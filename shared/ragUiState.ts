import type { RagStatus } from './rag';

const BUSY_PHASES = new Set<RagStatus['phase']>([
  'downloading',
  'loading',
  'scanning',
  'parsing',
  'embedding',
]);

export function ragActionState(input: {
  enabled: boolean;
  rootPath?: string;
  phase: RagStatus['phase'];
}): { canEnable: boolean; canScan: boolean; canRebuild: boolean; busy: boolean } {
  const busy = BUSY_PHASES.has(input.phase);
  const configured = !!input.rootPath;
  return {
    canEnable: input.enabled || configured,
    canScan: input.enabled && configured && !busy,
    canRebuild: input.enabled && configured && !busy,
    busy,
  };
}
