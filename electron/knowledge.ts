/**
 * Personal knowledge base: a single .md file (resume / project notes / domain
 * knowledge) the user imports. Injected into the answer system prompt so the
 * copilot answers from the user's REAL material (interview / leetcode-style
 * topic questions). Kept as a plain file — never in DOM storage.
 */
import { readFileSync, writeFileSync, existsSync, rmSync } from 'fs';

export class KnowledgeStore {
  private content = '';

  constructor(private readonly filePath: string) {
    this.load();
  }

  private load(): void {
    try {
      this.content = existsSync(this.filePath) ? readFileSync(this.filePath, 'utf8') : '';
    } catch {
      this.content = '';
    }
  }

  get text(): string {
    return this.content;
  }

  get chars(): number {
    return this.content.length;
  }

  /** Replace the KB from raw md text (already read from a picked file). */
  setFromText(md: string): void {
    this.content = md;
    writeFileSync(this.filePath, md, 'utf8');
  }

  clear(): void {
    this.content = '';
    try {
      if (existsSync(this.filePath)) rmSync(this.filePath);
    } catch {
      /* ignore */
    }
  }
}
