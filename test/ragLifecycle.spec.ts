import { describe, expect, it } from 'vitest';
import { decideRagLifecycle } from '../electron/ragHost';

describe('decideRagLifecycle', () => {
  it('does nothing while disabled or when enabled without a root', () => {
    expect(decideRagLifecycle({ enabled: false }, { enabled: false }, false)).toBe('none');
    expect(decideRagLifecycle({ enabled: false }, { enabled: true }, false)).toBe('none');
  });

  it('starts once enabled with a root', () => {
    expect(
      decideRagLifecycle(
        { enabled: false },
        { enabled: true, rootPath: 'C:\\Knowledge' },
        false,
      ),
    ).toBe('start');
  });

  it('restarts a running worker when the root changes', () => {
    expect(
      decideRagLifecycle(
        { enabled: true, rootPath: 'C:\\Old' },
        { enabled: true, rootPath: 'C:\\New' },
        true,
      ),
    ).toBe('restart');
  });

  it('stops a running worker when disabled', () => {
    expect(
      decideRagLifecycle(
        { enabled: true, rootPath: 'C:\\Knowledge' },
        { enabled: false, rootPath: 'C:\\Knowledge' },
        true,
      ),
    ).toBe('stop');
  });

  it('starts a configured worker that is unexpectedly not running', () => {
    expect(
      decideRagLifecycle(
        { enabled: true, rootPath: 'C:\\Knowledge' },
        { enabled: true, rootPath: 'C:\\Knowledge' },
        false,
      ),
    ).toBe('start');
  });
});
