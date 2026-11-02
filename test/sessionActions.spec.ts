import { describe, expect, it } from 'vitest';
import type { StoredSession } from '../shared/protocol';
import { restoreSession, sessionText } from '../shared/sessionActions';
const session: StoredSession = { id: 'a', name: '会议', createdAt: 0, turns: [{ id: 't', kind: 'free', label: 'Question', text: 'Answer', status: 'done' }], segments: [{ id: 1, text: 'Hello', speaker: 'them', startTs: 1, endTs: 2, translation: '你好' }], resumeText: 'PRIVATE RESUME', jdText: 'PRIVATE JD', memo: 'PRIVATE MEMO' };
describe('session safety actions', () => {
  it('exports visible transcript and Q&A, not hidden imported private content', () => {
    const text = sessionText(session);
    expect(text).toContain('会议\n'); expect(text).toContain('[Them] Hello');
    expect(text).toContain('你好'); expect(text).toContain('Q: Question\nA: Answer');
    expect(text).not.toContain('PRIVATE');
  });
  it('restores original material and position without duplicating on repeated undo', () => {
    const b = { ...session, id: 'b' };
    const restored = restoreSession([b], session, 0);
    expect(restored).toEqual([session, b]);
    expect(restored[0].resumeText).toBe('PRIVATE RESUME');
    expect(restoreSession(restored, session, 0)).toBe(restored);
  });
  it('clamps stale insertion position after other sessions are deleted', () => {
    expect(restoreSession([], session, 10)).toEqual([session]);
  });
});
