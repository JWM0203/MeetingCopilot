import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { hintSurface, installSurfaceHints, type SurfaceHint } from '../surfaceHints';

export function SurfaceHints() {
  const [hint, setHint] = useState<SurfaceHint | null>(null);
  useEffect(() => installSurfaceHints(document, window, setHint), []);
  // Description lives on the originating control; do not announce it twice.
  // Modal dialogs occupy the browser top layer, so keep their hints inside it.
  if (!hint) return null;
  const surface = hintSurface(document);
  return createPortal(<div className="surface-hint" aria-hidden="true" style={{ left: hint.x, top: hint.y }}>{hint.text}</div>, surface);
}
