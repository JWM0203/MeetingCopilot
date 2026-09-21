import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { SessionStore } from '../electron/sessions';
import type { SessionsFile } from '../shared/protocol';

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mc-sessions-rag-'));
  file = join(dir, 'sessions.json');
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('SessionStore RAG compatibility', () => {
  it('loads an old session with RAG disabled without rewriting the file', () => {
    const legacy = {
      currentId: 's1',
      sessions: [{ id: 's1', name: 'Old interview', createdAt: 1, turns: [] }],
    };
    writeFileSync(file, JSON.stringify(legacy), 'utf8');
    const before = readFileSync(file, 'utf8');

    const loaded = new SessionStore(file).load();

    expect(loaded.sessions[0].ragScope).toEqual({ enabled: false });
    expect(readFileSync(file, 'utf8')).toBe(before);
  });

  it('round-trips a selected scope and answer source references', () => {
    const data: SessionsFile = {
      currentId: 's1',
      sessions: [
        {
          id: 's1',
          name: 'Payments interview',
          createdAt: 1,
          turns: [
            {
              id: 't1',
              kind: 'segment',
              label: 'How did you prevent duplicate charges?',
              text: 'I introduced idempotency keys.',
              status: 'done',
              sources: [
                {
                  chunkId: 'c1',
                  documentId: 'd1',
                  name: 'payments.md',
                  relativePath: 'projects/payments.md',
                  score: 0.03,
                  excerpt: 'Used idempotency keys for payment requests.',
                },
              ],
            },
          ],
          ragScope: { enabled: true, includePaths: ['projects/payments.md'] },
        },
      ],
    };
    const store = new SessionStore(file);
    store.save(data);
    expect(store.load()).toEqual(data);
  });
});
