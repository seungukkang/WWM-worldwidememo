import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, normalizeSettings } from '../../src/core/settings';

describe('normalizeSettings', () => {
  it('returns defaults for missing or foreign data', () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings('x')).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps valid values and drops invalid ones', () => {
    expect(
      normalizeSettings({ toolbarMode: 'panel', toolbarPlacement: 'below', toolbarOpacity: 0.7 }),
    ).toEqual({ toolbarMode: 'panel', toolbarPlacement: 'below', toolbarOpacity: 0.7 });
    expect(normalizeSettings({ toolbarMode: 'huge', toolbarPlacement: 'left', unknown: true })).toEqual(DEFAULT_SETTINGS);
  });

  it('clamps opacity so the toolbar never disappears', () => {
    expect(normalizeSettings({ toolbarOpacity: 0 }).toolbarOpacity).toBe(0.5);
    expect(normalizeSettings({ toolbarOpacity: 3 }).toolbarOpacity).toBe(1);
    expect(normalizeSettings({ toolbarOpacity: Number.NaN }).toolbarOpacity).toBe(1);
  });
});
