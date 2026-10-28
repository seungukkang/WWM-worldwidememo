/**
 * Reading settings from any context. Writes go through the background
 * (`wwm/settings-set`), which stays the single writer of extension storage.
 */
import { normalizeSettings, SETTINGS_KEY, type Settings } from '../core/settings';

export async function loadSettings(): Promise<Settings> {
  const res = await chrome.storage.sync.get(SETTINGS_KEY);
  return normalizeSettings(res[SETTINGS_KEY]);
}

/** Call `cb` whenever settings change (e.g. from the side panel), in any open page. */
export function onSettingsChanged(cb: (s: Settings) => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    const change = changes[SETTINGS_KEY];
    if (area === 'sync' && change) cb(normalizeSettings(change.newValue));
  });
}
