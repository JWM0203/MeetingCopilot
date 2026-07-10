import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DOC_EXTENSIONS, extractDocText, normalizeDocText } from '../electron/docparse';

const FIX = join(__dirname, 'fixtures');

describe('extractDocText (deterministic resume/JD parsing)', () => {
  it('reads a .docx via mammoth (zh + en)', async () => {
    const text = await extractDocText(join(FIX, 'sample.docx'));
    expect(text).toContain('Docx fixture resume');
    expect(text).toContain('项目经历：实时转录 whisper DirectML');
  });

  it('reads a .pdf via pdf-parse without page-number artifacts', async () => {
    const text = await extractDocText(join(FIX, 'sample.pdf'));
    expect(text).toContain('Resume PDF fixture: Python and SQL');
    expect(text).not.toContain('-- 1 of 1 --');
  });

  it('reads plain .md/.txt as utf8', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mc-doc-'));
    const p = join(dir, 'kb.md');
    writeFileSync(p, '# 简历\n\n项目：MeetingCopilot', 'utf8');
    expect(await extractDocText(p)).toBe('# 简历\n\n项目：MeetingCopilot');
  });

  it('advertised extensions match parse support', () => {
    expect(DOC_EXTENSIONS).toEqual(['md', 'markdown', 'txt', 'docx', 'pdf']);
  });
});

describe('normalizeDocText', () => {
  it('collapses CRLF, trailing spaces and 3+ newlines', () => {
    expect(normalizeDocText('a  \r\n\r\n\r\n\r\nb\t\n')).toBe('a\n\nb');
  });
  it('empty input (scanned pdf) stays empty', () => {
    expect(normalizeDocText('  \n \n')).toBe('');
  });
});
