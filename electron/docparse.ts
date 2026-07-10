/**
 * Deterministic document→text extraction for session material (resume / JD).
 * NO LLM / function calling — parsing is a pure I/O task and the main answer
 * path is latency-first (HANDOFF §5 P0-2). Scanned/image-only PDFs have no
 * text layer and yield '' — the renderer surfaces that as a warning.
 */
import { readFileSync } from 'fs';
import { extname } from 'path';

/** extensions offered in the pick dialog (parse support below must match) */
export const DOC_EXTENSIONS = ['md', 'markdown', 'txt', 'docx', 'pdf'];

/** collapse parser artifacts: CRLF, trailing spaces, 3+ consecutive newlines */
export function normalizeDocText(t: string): string {
  return t
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function extractDocText(filePath: string): Promise<string> {
  const ext = extname(filePath).toLowerCase();
  if (ext === '.docx') {
    const mod: any = await import('mammoth');
    const mammoth = mod.default ?? mod;
    const r = await mammoth.extractRawText({ path: filePath });
    return normalizeDocText(r.value ?? '');
  }
  if (ext === '.pdf') {
    const mod: any = await import('pdf-parse');
    const PDFParse = mod.PDFParse ?? mod.default?.PDFParse;
    const parser = new PDFParse({ data: new Uint8Array(readFileSync(filePath)) });
    try {
      const r = await parser.getText({ pageJoiner: '' });
      return normalizeDocText(r.text ?? '');
    } finally {
      await parser.destroy();
    }
  }
  return normalizeDocText(readFileSync(filePath, 'utf8'));
}
