/**
 * User settings (stored in chrome.storage.sync: settings only, never
 * annotation data — AGENTS.md §12). Pure so stored values can be validated.
 */

/** What appears on the page when text is selected ('panel': nothing; use the side panel's style bar). */
export type ToolbarMode = 'full' | 'compact' | 'panel';
export type ToolbarPlacement = 'above' | 'below';

export interface Settings {
  toolbarMode: ToolbarMode;
  toolbarPlacement: ToolbarPlacement;
  /** 0.5..1; the toolbar becomes fully opaque on hover. */
  toolbarOpacity: number;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = {
  toolbarMode: 'full',
  toolbarPlacement: 'above',
  toolbarOpacity: 1,
};

export const SETTINGS_KEY = 'wwm:settings';
export const MIN_TOOLBAR_OPACITY = 0.5;

const MODES: readonly ToolbarMode[] = ['full', 'compact', 'panel'];
const PLACEMENTS: readonly ToolbarPlacement[] = ['above', 'below'];

/** Fill in defaults and drop invalid values (storage may hold older or foreign data). */
export function normalizeSettings(raw: unknown): Settings {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const opacity = typeof r.toolbarOpacity === 'number' && Number.isFinite(r.toolbarOpacity) ? r.toolbarOpacity : 1;
  return {
    toolbarMode: MODES.includes(r.toolbarMode as ToolbarMode) ? (r.toolbarMode as ToolbarMode) : DEFAULT_SETTINGS.toolbarMode,
    toolbarPlacement: PLACEMENTS.includes(r.toolbarPlacement as ToolbarPlacement)
      ? (r.toolbarPlacement as ToolbarPlacement)
      : DEFAULT_SETTINGS.toolbarPlacement,
    toolbarOpacity: Math.min(1, Math.max(MIN_TOOLBAR_OPACITY, opacity)),
  };
}
