/**
 * Multi-session store: persists the right-pane conversations to a plain JSON
 * file (never DOM storage). Each session = one meeting/interview with its own
 * turns and knowledge base.
 */
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';
import type { SessionsFile } from '../shared/protocol';

const EMPTY: SessionsFile = { sessions: [], currentId: null };

export class SessionStore {
  constructor(private readonly filePath: string) {}

  load(): SessionsFile {
    try {
      if (!existsSync(this.filePath)) return { ...EMPTY };
      const raw = JSON.parse(readFileSync(this.filePath, 'utf8')) as Partial<SessionsFile>;
      if (!Array.isArray(raw.sessions)) return { ...EMPTY };
      return { sessions: raw.sessions, currentId: raw.currentId ?? null };
    } catch (e) {
      console.warn('[sessions] load failed, starting empty:', (e as Error).message);
      return { ...EMPTY };
    }
  }

  save(data: SessionsFile): void {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      const tmp = `${this.filePath}.tmp`;
      writeFileSync(tmp, JSON.stringify(data), 'utf8');
      renameSync(tmp, this.filePath);
    } catch (e) {
      console.error('[sessions] save failed:', (e as Error).message);
    }
  }
}
