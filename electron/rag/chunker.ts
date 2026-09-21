import { createHash } from 'crypto';
import { basename } from 'path';
import type { RagChunk } from '../../shared/rag';

interface ChunkOptions {
  targetChars?: number;
  overlapChars?: number;
}

const DEFAULT_TARGET_CHARS = 650;
const DEFAULT_OVERLAP_CHARS = 80;

function normalizeText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function chunkHash(text: string): string {
  return createHash('sha256').update(normalizeText(text), 'utf8').digest('hex');
}

function splitLongBlock(block: string, targetChars: number): string[] {
  if (block.length <= targetChars) return [block];
  const sentences = block
    .split(/(?<=[。！？.!?；;])\s*/u)
    .map((part) => part.trim())
    .filter(Boolean);
  const parts: string[] = [];
  let current = '';

  const flush = () => {
    if (current) parts.push(current);
    current = '';
  };

  for (const sentence of sentences.length ? sentences : [block]) {
    if (sentence.length > targetChars) {
      flush();
      for (let offset = 0; offset < sentence.length; offset += targetChars) {
        parts.push(sentence.slice(offset, offset + targetChars));
      }
      continue;
    }
    const next = current ? `${current} ${sentence}` : sentence;
    if (next.length > targetChars) flush();
    current = current ? `${current} ${sentence}` : sentence;
  }
  flush();
  return parts;
}

function tailForOverlap(text: string, overlapChars: number): string {
  if (overlapChars <= 0) return '';
  const tail = text.slice(-overlapChars);
  const boundary = tail.search(/[\s。！？.!?；;]/u);
  return (boundary >= 0 ? tail.slice(boundary + 1) : tail).trim();
}

export function chunkDocument(
  documentId: string,
  relativePath: string,
  text: string,
  options: ChunkOptions = {},
): RagChunk[] {
  const normalized = normalizeText(text);
  if (!normalized) return [];

  const targetChars = Math.max(16, options.targetChars ?? DEFAULT_TARGET_CHARS);
  const overlapChars = Math.max(0, Math.min(options.overlapChars ?? DEFAULT_OVERLAP_CHARS, targetChars / 2));
  const blocks = normalized.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
  const units: string[] = [];
  let heading = '';

  for (const block of blocks) {
    if (/^#{1,6}\s+/.test(block) && !block.includes('\n')) {
      if (heading) units.push(heading);
      heading = block;
      continue;
    }
    const combined = heading ? `${heading}\n${block}` : block;
    heading = '';
    units.push(...splitLongBlock(combined, targetChars));
  }
  if (heading) units.push(heading);

  const texts: string[] = [];
  let current = '';
  for (const unit of units) {
    const next = current ? `${current}\n\n${unit}` : unit;
    if (current && next.length > targetChars) {
      texts.push(current);
      const overlap = tailForOverlap(current, overlapChars);
      current = overlap ? `${overlap}\n\n${unit}` : unit;
    } else {
      current = next;
    }
  }
  if (current) texts.push(current);

  const title = basename(relativePath.replace(/\\/g, '/'));
  return texts.map((chunkText, ordinal) => {
    const hash = chunkHash(chunkText);
    return {
      id: `${documentId}:${ordinal}:${hash.slice(0, 12)}`,
      documentId,
      relativePath: relativePath.replace(/\\/g, '/'),
      title,
      text: chunkText,
      ordinal,
      hash,
    };
  });
}
