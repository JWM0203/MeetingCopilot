import type { StoredSession } from './protocol';

/** Plain text export deliberately excludes imported private material and hidden memo. */
export function sessionText(session: StoredSession): string {
  const lines = [session.name, '', 'Transcript', '----------'];
  for (const segment of session.segments ?? []) {
    lines.push(`[${segment.speaker === 'me' ? 'Me' : 'Them'}] ${segment.text}`);
    if (segment.translation) lines.push(segment.translation);
  }
  lines.push('', 'Answers', '-------');
  for (const turn of session.turns) {
    lines.push('', `Q: ${turn.label}`, `A: ${turn.text}`);
    if (turn.status !== 'done') lines.push(`[${turn.status}]`);
  }
  return lines.join('\n') + '\n';
}

export function restoreSession(sessions: StoredSession[], removed: StoredSession, index: number): StoredSession[] {
  if (sessions.some((session) => session.id === removed.id)) return sessions;
  const next = [...sessions];
  next.splice(Math.max(0, Math.min(index, next.length)), 0, removed);
  return next;
}
