/**
 * Multi-slot session material helpers (shared by main / renderer / tests).
 * A session holds LISTS of resumes and project-code digests; the prompt layer
 * combines them deterministically — same inputs always yield the same bytes,
 * so the stable prefix (and its provider KV cache) stays intact.
 */

export interface MaterialItem {
  /** display name: file / folder name */
  name: string;
  /** resume text (as parsed) or project digest (as scanned) */
  text: string;
}

/** per-item header allowance when splitting the code budget across digests */
const HEADER_ALLOWANCE = 40;
/** floor so a digest is never clipped to nothing in a large collection */
const MIN_PER_ITEM = 600;

/**
 * Join multiple resumes into one 【简历】 block. Single item → plain text (the
 * exact legacy prompt shape, so existing users' cached prefixes still hit);
 * multiple items → numbered headers 【简历 1/N：name】. Empty texts are dropped.
 */
export function joinResumes(items: MaterialItem[]): string {
  const list = items
    .map((it) => ({ name: it.name, text: it.text.trim() }))
    .filter((it) => it.text);
  return list
    .map((it, i) =>
      list.length > 1 ? `【简历 ${i + 1}/${list.length}：${it.name}】\n${it.text}` : it.text,
    )
    .join('\n\n');
}

/**
 * Combine several project digests under numbered 【项目 i/N：name】 headers,
 * splitting `budget` EVENLY between them (each digest keeps its head — digest
 * sections are priority-ordered, so the head is the most valuable part).
 * Deterministic for any fixed input set.
 */
export function combineCodeDigests(items: MaterialItem[], budget = 8000): string {
  const list = items
    .map((it) => ({ name: it.name, text: it.text.trim() }))
    .filter((it) => it.text);
  if (!list.length) return '';
  const per = Math.max(Math.floor((budget - list.length * HEADER_ALLOWANCE) / list.length), MIN_PER_ITEM);
  return list
    .map((it, i) => {
      const body = it.text.slice(0, per);
      return list.length > 1 ? `【项目 ${i + 1}/${list.length}：${it.name}】\n${body}` : body;
    })
    .join('\n\n');
}
