import { describe, expect, it } from 'vitest';
import {
  appendSegment,
  joinTexts,
  nextSegmentId,
  percentile,
  reindexSegments,
  type TranscriptSegment,
} from '../shared/transcript';

function seg(id: number, text: string, startTs: number, endTs: number): TranscriptSegment {
  return { id, text, startTs, endTs };
}

describe('joinTexts', () => {
  it('joins CJK without space, latin with space', () => {
    expect(joinTexts('你好', '世界')).toBe('你好世界');
    expect(joinTexts('hello', 'world')).toBe('hello world');
    expect(joinTexts('我们用的是 React', '和 TypeScript')).toBe('我们用的是 React和 TypeScript');
    expect(joinTexts('', 'x')).toBe('x');
    expect(joinTexts('x', '')).toBe('x');
  });
});

describe('nextSegmentId / reindexSegments', () => {
  it('derives ids from the session list, not the worker counter', () => {
    expect(nextSegmentId([])).toBe(1);
    expect(nextSegmentId([seg(1, 'a', 0, 1), seg(5, 'b', 10_000, 10_001)])).toBe(6);
    // legacy duplicates (worker counter reset) still yield a unique next id
    expect(nextSegmentId([seg(3, 'a', 0, 1), seg(3, 'b', 10_000, 10_001)])).toBe(4);
  });

  it('reindexSegments heals persisted duplicate ids', () => {
    const healed = reindexSegments([seg(2, 'a', 0, 1), seg(2, 'b', 10_000, 10_001)]);
    expect(healed.map((s) => s.id)).toEqual([1, 2]);
    expect(healed.map((s) => s.text)).toEqual(['a', 'b']);
  });
});

describe('appendSegment', () => {
  it('never merges into a translated or translating bubble', () => {
    const translated: TranscriptSegment = { ...seg(1, 'How can we live', 0, 1000), translation: '我们如何生活' };
    let list = appendSegment([translated], seg(2, 'more meaningfully', 1500, 2500));
    expect(list).toHaveLength(2); // 译文不与合并后原文错位

    const translating: TranscriptSegment = { ...seg(1, 'How can we live', 0, 1000), translating: true };
    list = appendSegment([translating], seg(2, 'more meaningfully', 1500, 2500));
    expect(list).toHaveLength(2);
  });

  it('appends distinct segments', () => {
    let list: TranscriptSegment[] = [];
    list = appendSegment(list, seg(1, '第一句', 0, 1000));
    list = appendSegment(list, seg(2, '第二句', 10_000, 11_000));
    expect(list).toHaveLength(2);
  });

  it('merges fragments arriving within the merge window', () => {
    let list: TranscriptSegment[] = [];
    list = appendSegment(list, seg(1, '这句话被', 0, 1000));
    list = appendSegment(list, seg(2, '拆成了两半', 2000, 3000)); // gap 1000ms < 2500
    expect(list).toHaveLength(1);
    expect(list[0].text).toBe('这句话被拆成了两半');
    expect(list[0].endTs).toBe(3000);
  });

  it('does not merge beyond the window or past max length', () => {
    let list: TranscriptSegment[] = [];
    list = appendSegment(list, seg(1, 'a', 0, 1000));
    list = appendSegment(list, seg(2, 'b', 5000, 6000)); // gap 4000 > 2500
    expect(list).toHaveLength(2);

    const long = 'x'.repeat(590);
    let l2: TranscriptSegment[] = [];
    l2 = appendSegment(l2, seg(1, long, 0, 1000));
    l2 = appendSegment(l2, seg(2, 'y'.repeat(20), 1500, 2000)); // merged would exceed 600
    expect(l2).toHaveLength(2);
  });

  it('ignores empty/whitespace text', () => {
    let list: TranscriptSegment[] = [];
    list = appendSegment(list, seg(1, '   ', 0, 1000));
    expect(list).toHaveLength(0);
  });

  it('caps the list at maxSegments dropping oldest', () => {
    let list: TranscriptSegment[] = [];
    for (let i = 0; i < 30; i++) {
      list = appendSegment(list, seg(i, `s${i}`, i * 10_000, i * 10_000 + 1000), {
        mergeWindowMs: 2500,
        maxMergedChars: 600,
        maxSegments: 10,
      });
    }
    expect(list).toHaveLength(10);
    expect(list[0].text).toBe('s20');
  });

  it('never merges fragments from different speakers (dual-channel)', () => {
    let list: TranscriptSegment[] = [];
    list = appendSegment(list, { id: 1, text: '对方说的', startTs: 0, endTs: 1000, speaker: 'them' });
    // arrives within the merge window but from the mic — must stay separate
    list = appendSegment(list, { id: 2, text: '我说的', startTs: 1500, endTs: 2000, speaker: 'me' });
    expect(list).toHaveLength(2);
    expect(list[0].speaker).toBe('them');
    expect(list[1].speaker).toBe('me');
  });

  it('merges same-speaker fragments', () => {
    let list: TranscriptSegment[] = [];
    list = appendSegment(list, { id: 1, text: '前半', startTs: 0, endTs: 1000, speaker: 'me' });
    list = appendSegment(list, { id: 2, text: '后半', startTs: 2000, endTs: 3000, speaker: 'me' });
    expect(list).toHaveLength(1);
    expect(list[0].speaker).toBe('me');
  });

  it('does not mutate the input array', () => {
    const list = [seg(1, 'a', 0, 1000)];
    const out = appendSegment(list, seg(2, 'b', 1500, 2000));
    expect(list).toHaveLength(1);
    expect(out).toHaveLength(1); // merged
    expect(list[0].text).toBe('a');
  });
});

describe('percentile', () => {
  it('computes p50/p95', () => {
    const vals = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100
    expect(percentile(vals, 50)).toBe(50);
    expect(percentile(vals, 95)).toBe(95);
    expect(percentile([], 50)).toBeUndefined();
    expect(percentile([7], 95)).toBe(7);
  });
});
