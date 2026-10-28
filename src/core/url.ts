/**
 * Page identity. Two URLs with the same pageKey share annotations.
 * See docs/design/data-model.md §3.
 */

const TRACKING_PARAMS = new Set([
  'fbclid',
  'gclid',
  'dclid',
  'msclkid',
  'mc_cid',
  'mc_eid',
  'igshid',
  'ref_src',
  'spm',
  '_hsenc',
  '_hsmi',
]);

function isTrackingParam(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.startsWith('utm_') || TRACKING_PARAMS.has(lower);
}

/**
 * Normalize a URL into a stable page key.
 * - lowercases scheme/host, drops default ports and `www.` is kept (sites differ)
 * - removes tracking params, sorts remaining params
 * - drops the fragment unless it looks like a SPA route (`#/` or `#!/`)
 * - trims a trailing slash on non-root paths
 */
export function normalizePageKey(rawUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return rawUrl;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return url.href;
  }

  const params = [...url.searchParams.entries()]
    .filter(([k]) => !isTrackingParam(k))
    .sort(([a, av], [b, bv]) => (a === b ? av.localeCompare(bv) : a.localeCompare(b)));
  const search = new URLSearchParams(params).toString();

  let path = url.pathname;
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);

  const hash = url.hash.startsWith('#/') || url.hash.startsWith('#!/') ? url.hash : '';
  const host = url.host.toLowerCase(); // URL already strips default ports

  return `${url.protocol}//${host}${path}${search ? `?${search}` : ''}${hash}`;
}

const PDF_KEY_PREFIX = 'pdf:';

/**
 * Page key for a PDF opened in the WWM viewer: the pdf.js document fingerprint,
 * so the same file shares annotations across URLs. A new revision of a file
 * (e.g. arXiv v2) has a different fingerprint and is a different page.
 */
export function pdfPageKey(fingerprint: string): string {
  return PDF_KEY_PREFIX + fingerprint.toLowerCase();
}

export function isPdfPageKey(pageKey: string): boolean {
  return pageKey.startsWith(PDF_KEY_PREFIX);
}
