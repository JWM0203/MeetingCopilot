import { describe, expect, it } from 'vitest';
import { chunkDocument, chunkHash } from '../electron/rag/chunker';

describe('RAG document chunking', () => {
  it('keeps headings with following text and bounds chunk size', () => {
    const text = [
      '# 项目经历',
      '',
      `实时面试助手。${'性能优化。'.repeat(180)}`,
      '',
      '## 技术栈',
      '',
      'Electron React TypeScript',
    ].join('\n');

    const chunks = chunkDocument('doc-1', 'resume.md', text, {
      targetChars: 600,
      overlapChars: 80,
    });

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].text).toContain('项目经历');
    expect(chunks.every((chunk) => chunk.text.trim().length > 0)).toBe(true);
    expect(chunks.every((chunk) => chunk.text.length <= 800)).toBe(true);
    expect(chunks.at(-1)?.text).toContain('技术栈');
  });

  it('is deterministic and gives every chunk a stable unique id', () => {
    const text = '# One\n\nFirst paragraph.\n\n# Two\n\nSecond paragraph.';
    const first = chunkDocument('doc-1', 'notes/file.md', text, {
      targetChars: 20,
      overlapChars: 5,
    });
    const second = chunkDocument('doc-1', 'notes/file.md', text, {
      targetChars: 20,
      overlapChars: 5,
    });

    expect(first).toEqual(second);
    expect(new Set(first.map((chunk) => chunk.id)).size).toBe(first.length);
    expect(first.every((chunk, index) => chunk.ordinal === index)).toBe(true);
  });

  it('normalizes equivalent line endings and trailing whitespace before hashing', () => {
    expect(chunkHash('hello\r\nworld  ')).toBe(chunkHash('hello\nworld'));
  });

  it('returns no chunks for empty input', () => {
    expect(chunkDocument('doc-1', 'empty.txt', ' \r\n ')).toEqual([]);
  });
});
