/**
 * User settings (stored in chrome.storage.sync: settings only, never
 * annotation data — AGENTS.md §12). Pure so stored values can be validated.
 */

/** What appears on the page when text is selected ('panel': nothing; use the side panel's style bar). */
export type ToolbarMode = 'full' | 'compact' | 'panel';
export type ToolbarPlacement = 'above' | 'below';

export interface Settings {
  /** Off: nothing on pages — no toolbar and no highlights. Annotations are kept. */
  enabled: boolean;
  /** Sites (hostnames) where WWM is off, as with `enabled: false`. */
  disabledSites: string[];
  toolbarMode: ToolbarMode;
  toolbarPlacement: ToolbarPlacement;
  /** 0.5..1; the toolbar becomes fully opaque on hover. */
  toolbarOpacity: number;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = {
  enabled: true,
  disabledSites: [],
  toolbarMode: 'full',
  toolbarPlacement: 'above',
  toolbarOpacity: 1,
};

export const SETTINGS_KEY = 'wwm:settings';
export const MIN_TOOLBAR_OPACITY = 0.5;
/** storage.sync items are limited to 8 KB; plenty for a list of hostnames. */
const MAX_DISABLED_SITES = 200;

const MODES: readonly ToolbarMode[] = ['full', 'compact', 'panel'];
const PLACEMENTS: readonly ToolbarPlacement[] = ['above', 'below'];

/** Fill in defaults and drop invalid values (storage may hold older or foreign data). */
export function normalizeSettings(raw: unknown): Settings {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const opacity = typeof r.toolbarOpacity === 'number' && Number.isFinite(r.toolbarOpacity) ? r.toolbarOpacity : 1;
  const sites = Array.isArray(r.disabledSites)
    ? r.disabledSites.filter((s): s is string => typeof s === 'string' && s.length > 0).map((s) => s.toLowerCase())
    : [];
  return {
    enabled: typeof r.enabled === 'boolean' ? r.enabled : DEFAULT_SETTINGS.enabled,
    disabledSites: [...new Set(sites)].slice(0, MAX_DISABLED_SITES),
    toolbarMode: MODES.includes(r.toolbarMode as ToolbarMode) ? (r.toolbarMode as ToolbarMode) : DEFAULT_SETTINGS.toolbarMode,
    toolbarPlacement: PLACEMENTS.includes(r.toolbarPlacement as ToolbarPlacement)
      ? (r.toolbarPlacement as ToolbarPlacement)
      : DEFAULT_SETTINGS.toolbarPlacement,
    toolbarOpacity: Math.min(1, Math.max(MIN_TOOLBAR_OPACITY, opacity)),
  };
}

/** The site of a page for per-site switches: its hostname, or null for non-web pages. */
export function siteOf(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** Whether WWM shows anything on the page at `url` (switched on, and not off for its site). */
export function isActiveOn(settings: Settings, url: string): boolean {
  if (!settings.enabled) return false;
  const site = siteOf(url);
  return site === null || !settings.disabledSites.includes(site);
}
