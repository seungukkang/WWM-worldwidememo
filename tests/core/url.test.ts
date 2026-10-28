import { describe, expect, it } from 'vitest';
import { normalizePageKey } from '../../src/core/url';

describe('normalizePageKey', () => {
  it('drops tracking params and sorts the rest', () => {
    expect(normalizePageKey('https://Example.com/a?utm_source=x&b=2&a=1&fbclid=zz')).toBe(
      'https://example.com/a?a=1&b=2',
    );
  });

  it('drops plain fragments but keeps SPA hash routes', () => {
    expect(normalizePageKey('https://example.com/doc#section-2')).toBe('https://example.com/doc');
    expect(normalizePageKey('https://example.com/#/settings/profile')).toBe('https://example.com/#/settings/profile');
  });

  it('trims trailing slash except at root and drops default ports', () => {
    expect(normalizePageKey('https://example.com:443/blog/')).toBe('https://example.com/blog');
    expect(normalizePageKey('http://example.com:80/')).toBe('http://example.com/');
  });

  it('returns non-http(s) URLs and garbage unchanged', () => {
    expect(normalizePageKey('file:///tmp/a.html')).toBe('file:///tmp/a.html');
    expect(normalizePageKey('not a url')).toBe('not a url');
  });
});
