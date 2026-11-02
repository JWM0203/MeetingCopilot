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

/** Shift a measured popup into the viewport without changing selection/focus. */
export function popupViewportCorrection(rect: Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom' | 'width' | 'height'>, width: number, height: number) {
  const margin = 4;
  const left = Math.max(margin, Math.min(rect.left, width - margin - rect.width));
  const top = Math.max(margin, Math.min(rect.top, height - margin - rect.height));
  return { x: left - rect.left, y: top - rect.top };
}
