import { describe, expect, it } from 'vitest';
import { readTranscriptSelection, popupViewportCorrection } from '../src/transcriptSelection';
const leftA = {} as Node, leftB = {} as Node, outside = {} as Node;
const root = { contains: (n: Node | null) => n === leftA || n === leftB };
function selection(overrides: Partial<Selection> = {}, bounds: [Node, Node] = [leftA, leftA]): Selection {
  return { isCollapsed: false, rangeCount: 1, anchorNode: leftA, focusNode: leftA,
    toString: () => ' selected fragment ',
    getRangeAt: () => ({ startContainer: bounds[0], endContainer: bounds[1] }) as Range,
    ...overrides } as Selection;
}
describe('live transcript selection', () => {
  it('keeps an exact local fragment, not the whole bubble', () => {
    expect(readTranscriptSelection(root, selection())?.text).toBe('selected fragment');
  });
  it.each([false, true])('accepts cross-bubble selections in either direction: reversed=%s', reversed => {
    const s = selection({ anchorNode: reversed ? leftB : leftA, focusNode: reversed ? leftA : leftB, toString: () => 'tail of first\nhead of second' }, [leftA, leftB]);
    expect(readTranscriptSelection(root, s)?.text).toBe('tail of first\nhead of second');
  });
  it.each([null, selection({ isCollapsed: true }), selection({ rangeCount: 0 }), selection({ rangeCount: 2 }), selection({ toString: () => '  ' })])('rejects absent/collapsed/empty or disjoint selection', s => {
    expect(readTranscriptSelection(root, s)).toBeNull();
  });
  it.each([{ anchorNode: outside }, { focusNode: outside }])('rejects either endpoint outside the transcript', endpoints => {
    expect(readTranscriptSelection(root, selection(endpoints))).toBeNull();
  });
  it.each([[outside, leftA], [leftA, outside]] as [Node, Node][])('also validates actual range boundaries', (start, end) => {
    expect(readTranscriptSelection(root, selection({}, [start, end]))).toBeNull();
  });
  it('does not return a previously captured value after selection is cleared or moved', () => {
    expect(readTranscriptSelection(root, selection())?.text).toBe('selected fragment');
    expect(readTranscriptSelection(root, null)).toBeNull();
    expect(readTranscriptSelection(root, selection({ focusNode: outside }))).toBeNull();
    expect(readTranscriptSelection(null, selection())).toBeNull();
  });
});


describe('popup viewport correction', () => {
  it.each([
    [-36.5, 98, 131.4, 31, 40.5, 0],
    [600, 98, 131, 31, -95, 0],
    [20, -20, 131, 31, 0, 24],
    [20, 370, 131, 31, 0, -25],
    [20, 98, 131, 31, 0, 0],
  ])('clamps measured bounds (%s,%s)', (left, top, width, height, x, y) => {
    expect(popupViewportCorrection({left,top,width,height,right:left+width,bottom:top+height},640,380)).toEqual({x,y});
  });
});
