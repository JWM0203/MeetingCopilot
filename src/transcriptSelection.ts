/** Read the live left-pane selection; never submit cached or cross-pane text. */
export function readTranscriptSelection(root: Pick<HTMLElement, 'contains'> | null, selection: Selection | null): { text: string; range: Range } | null {
  if (!root || !selection || selection.isCollapsed || selection.rangeCount !== 1) return null;
  const text = selection.toString().trim();
  if (!text || !selection.anchorNode || !selection.focusNode ||
      !root.contains(selection.anchorNode) || !root.contains(selection.focusNode)) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  return { text, range };
}
