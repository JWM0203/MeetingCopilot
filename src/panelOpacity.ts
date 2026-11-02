import { clampOpacity } from '../shared/opacity';

/**
 * Stamp ui.opacity onto <html> as --app-alpha (see src/styles.css). Called by
 * App.tsx whenever settings change and by the settings slider for live preview.
 */
export function applyPanelOpacity(value: number | undefined): void {
  document.documentElement.style.setProperty('--app-alpha', String(clampOpacity(value)));
}
