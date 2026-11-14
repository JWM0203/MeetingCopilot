import { describe, expect, it } from 'vitest';
import { combineCodeDigests, joinResumes, type MaterialItem } from '../shared/material';

describe('joinResumes (multi-resume prompt material)', () => {
  it('returns plain text for a single resume (legacy prompt shape preserved)', () => {
    const out = joinResumes([{ name: 'a.md', text: '我的经历' }]);
    expect(out).toBe('我的经历');
    expect(out).not.toContain('【简历');
  });
  it('numbers and labels every resume when there are several', () => {
    const items: MaterialItem[] = [
      { name: 'resume-a.md', text: '项目A经历' },
      { name: 'resume-b.pdf', text: '项目B经历' },
    ];
    const out = joinResumes(items);
    expect(out).toContain('【简历 1/2：resume-a.md】');
    expect(out).toContain('项目A经历');
    expect(out).toContain('【简历 2/2：resume-b.pdf】');
    expect(out).toContain('项目B经历');
  });
  it('drops empty resumes and renumbers the rest', () => {
    const items: MaterialItem[] = [
      { name: 'a', text: '有内容' },
      { name: 'b', text: '   ' },
    ];
    expect(joinResumes(items)).toBe('有内容');
  });
  it('is deterministic', () => {
    const items: MaterialItem[] = [
      { name: 'a', text: 'x'.repeat(100) },
      { name: 'b', text: 'y'.repeat(100) },
    ];
    expect(joinResumes(items)).toBe(joinResumes(items));
  });
});

describe('combineCodeDigests (multi-project prompt material)', () => {
  it('returns the single digest unchanged (no header, legacy shape)', () => {
    const digest = 'src/a.ts (10 行) · foo';
    expect(combineCodeDigests([{ name: 'proj', text: digest }])).toBe(digest);
  });
  it('splits the budget evenly and labels every project', () => {
    const long = 'A'.repeat(9000);
    const out = combineCodeDigests(
      [
        { name: 'projA', text: long },
        { name: 'projB', text: 'B'.repeat(9000) },
      ],
      8000,
    );
    expect(out).toContain('【项目 1/2：projA】');
    expect(out).toContain('【项目 2/2：projB】');
    // each body keeps its head: 8000 split in two minus header allowance
    expect(out).toContain('A'.repeat(3900));
    expect(out).toContain('B'.repeat(3900));
    // and never exceeds the total budget (headers included)
    expect(out.length).toBeLessThanOrEqual(8100);
  });
  it('never clips a digest below the floor', () => {
    const long = 'C'.repeat(20000);
    const out = combineCodeDigests(
      Array.from({ length: 20 }, (_, i) => ({ name: `p${i}`, text: long })),
      8000,
    );
    // 20 items: per-item share would be 360 → floored at 600
    expect(out).toContain('C'.repeat(600));
  });
  it('drops empty digests', () => {
    expect(combineCodeDigests([{ name: 'p', text: '  ' }])).toBe('');
  });
  it('is deterministic', () => {
    const items: MaterialItem[] = [
      { name: 'a', text: 'x'.repeat(5000) },
      { name: 'b', text: 'y'.repeat(5000) },
    ];
    expect(combineCodeDigests(items, 8000)).toBe(combineCodeDigests(items, 8000));
  });
});
