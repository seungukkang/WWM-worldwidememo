import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, isActiveOn, normalizeSettings, siteOf } from '../../src/core/settings';

describe('normalizeSettings', () => {
  it('returns defaults for missing or foreign data', () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings('x')).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps valid values and drops invalid ones', () => {
    expect(
      normalizeSettings({ toolbarMode: 'panel', toolbarPlacement: 'below', toolbarOpacity: 0.7 }),
    ).toEqual({ ...DEFAULT_SETTINGS, toolbarMode: 'panel', toolbarPlacement: 'below', toolbarOpacity: 0.7 });
    expect(normalizeSettings({ toolbarMode: 'huge', toolbarPlacement: 'left', unknown: true })).toEqual(DEFAULT_SETTINGS);
  });

  it('clamps opacity so the toolbar never disappears', () => {
    expect(normalizeSettings({ toolbarOpacity: 0 }).toolbarOpacity).toBe(0.5);
    expect(normalizeSettings({ toolbarOpacity: 3 }).toolbarOpacity).toBe(1);
    expect(normalizeSettings({ toolbarOpacity: Number.NaN }).toolbarOpacity).toBe(1);
  });
});

describe('on/off', () => {
  it('normalizes the switch and the site list', () => {
    expect(normalizeSettings({ enabled: false }).enabled).toBe(false);
    expect(normalizeSettings({ enabled: 'no' }).enabled).toBe(true);
    expect(normalizeSettings({ disabledSites: ['Slack.com', 'slack.com', 3, ''] }).disabledSites).toEqual(['slack.com']);
  });

  it('is active unless switched off globally or for the site', () => {
    const s = normalizeSettings({ disabledSites: ['app.slack.com'] });
    expect(siteOf('https://App.Slack.com/client/T1')).toBe('app.slack.com');
    expect(siteOf('chrome-extension://abc/pdf/viewer.html')).toBeNull();
    expect(isActiveOn(s, 'https://example.com/a')).toBe(true);
    expect(isActiveOn(s, 'https://app.slack.com/client/T1')).toBe(false);
    expect(isActiveOn({ ...s, enabled: false }, 'https://example.com/a')).toBe(false);
  });
});
