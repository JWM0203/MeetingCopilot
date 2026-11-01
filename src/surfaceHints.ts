/** Never use native HTML title popups in the overlay: they may be separate OS surfaces. */
export function hintProps(text: string | undefined): { 'data-hint'?: string; 'aria-description'?: string } {
  return text ? { 'data-hint': text, 'aria-description': text } : {};
}
export function hintSurface(doc: Document): Element {
  return doc.querySelector('dialog[open]') ?? doc.body;
}
export interface SurfaceHint { text: string; x: number; y: number }

/** Shared pointer/keyboard lifecycle; the view renders in this BrowserWindow, never a native popup. */
export function installSurfaceHints(doc: Document, host: Window, show: (hint: SurfaceHint | null) => void): () => void {
  let current: HTMLElement | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const hide = () => {
    clearTimeout(timer);
    timer = undefined;
    current = null;
    show(null);
  };
  const reveal = (element: HTMLElement, delay: number) => {
    if (element === current && delay > 0) return;
    hide();
    const text = element.dataset.hint;
    if (!text) return;
    current = element;
    timer = setTimeout(() => {
      if (current !== element || !element.isConnected) return;
      const rect = element.getBoundingClientRect();
      show({ text, x: Math.max(8, Math.min(rect.left, host.innerWidth - 288)), y: Math.max(8, Math.min(rect.bottom + 6, host.innerHeight - 96)) });
    }, delay);
  };
  const targetHint = (target: EventTarget | null) => (target as Element | null)?.closest?.<HTMLElement>('[data-hint]') ?? null;
  const pointerOver = (event: Event) => { const target = targetHint(event.target); if (target) reveal(target, 450); };
  const pointerOut = (event: Event) => {
    const next = (event as PointerEvent).relatedTarget;
    if (current && (!next || !current.contains(next as Node))) hide();
  };
  const focusIn = (event: Event) => { const target = targetHint(event.target); if (target) reveal(target, 0); };
  const keyDown = (event: Event) => { if ((event as KeyboardEvent).key === 'Escape') hide(); };
  const events: [string, EventListener][] = [
    ['pointerover', pointerOver], ['pointerout', pointerOut], ['focusin', focusIn],
    ['focusout', hide], ['keydown', keyDown], ['pointerdown', hide], ['scroll', hide],
  ];
  for (const [name, listener] of events) doc.addEventListener(name, listener, { capture: true });
  host.addEventListener('blur', hide);
  host.addEventListener('resize', hide);
  return () => {
    hide();
    for (const [name, listener] of events) doc.removeEventListener(name, listener, { capture: true });
    host.removeEventListener('blur', hide);
    host.removeEventListener('resize', hide);
  };
}
