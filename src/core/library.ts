/**
 * The side panel's library ([All] tab): filter chips, search and label
 * helpers. Pure functions over stored records. See docs/design/library.md.
 */
import { getSelector, LABEL_COLORS, type Annotation, type Label, type LabelColor, type PageRecord } from './types';
import { isPdfPageKey } from './url';

export type LibraryFilter =
  | { kind: 'all' }
  | { kind: 'label'; id: string }
  | { kind: 'notes' }
  | { kind: 'attention' }
  | { kind: 'pdf' };

export interface LibraryCounts {
  all: number;
  notes: number;
  attention: number;
  pdf: number;
  labels: Record<string, number>;
}

export function liveAnnotations(page: PageRecord): Annotation[] {
  return page.annotations.filter((a) => !a.deletedAt);
}

const fold = (s: string): string => s.normalize('NFC').toLocaleLowerCase();

/** Every whitespace-separated term occurs in the title, URL, a quote or a note. */
export function pageMatchesQuery(page: PageRecord, query: string): boolean {
  const terms = fold(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const parts = [page.title ?? '', page.url];
  for (const a of liveAnnotations(page)) {
    parts.push(getSelector(a.target.selectors, 'TextQuoteSelector')?.exact ?? '', a.note ?? '');
  }
  const haystack = fold(parts.join('\n'));
  return terms.every((t) => haystack.includes(t));
}

export function pageMatchesFilter(page: PageRecord, filter: LibraryFilter): boolean {
  const live = liveAnnotations(page);
  switch (filter.kind) {
    case 'all':
      return true;
    case 'label':
      return page.labelIds?.includes(filter.id) ?? false;
    case 'notes':
      return live.some((a) => Boolean(a.note));
    case 'attention':
      return live.some((a) => a.anchor?.status === 'needs-review' || a.anchor?.status === 'orphaned');
    case 'pdf':
      return isPdfPageKey(page.pageKey);
  }
}

/** Pages with live annotations matching the search and the chip, most recently edited first. */
export function filterPages(pages: readonly PageRecord[], query: string, filter: LibraryFilter): PageRecord[] {
  return pages
    .filter((p) => liveAnnotations(p).length > 0 && pageMatchesQuery(p, query) && pageMatchesFilter(p, filter))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Chip counts after applying the search. */
export function countPages(pages: readonly PageRecord[], query: string, labels: readonly Label[]): LibraryCounts {
  const found = filterPages(pages, query, { kind: 'all' });
  const count = (f: LibraryFilter): number => found.filter((p) => pageMatchesFilter(p, f)).length;
  return {
    all: found.length,
    notes: count({ kind: 'notes' }),
    attention: count({ kind: 'attention' }),
    pdf: count({ kind: 'pdf' }),
    labels: Object.fromEntries(labels.map((l) => [l.id, count({ kind: 'label', id: l.id })])),
  };
}

/** The page's live labels, in label order. */
export function labelsOfPage(page: PageRecord | undefined, labels: readonly Label[]): Label[] {
  const ids = new Set(page?.labelIds ?? []);
  return labels.filter((l) => !l.deletedAt && ids.has(l.id)).sort((a, b) => a.order - b.order);
}

/** A color for a new label: the least used one, in palette order. */
export function nextLabelColor(labels: readonly Label[]): LabelColor {
  const used = new Map<LabelColor, number>(LABEL_COLORS.map((c) => [c, 0]));
  for (const l of labels) if (!l.deletedAt) used.set(l.color, (used.get(l.color) ?? 0) + 1);
  return [...LABEL_COLORS].sort((a, b) => (used.get(a) ?? 0) - (used.get(b) ?? 0))[0] ?? 'yellow';
}

/** The next color in the palette (the manage view cycles colors on click). */
export function cycleLabelColor(color: LabelColor): LabelColor {
  return LABEL_COLORS[(LABEL_COLORS.indexOf(color) + 1) % LABEL_COLORS.length] ?? 'yellow';
}

/** Label ids in order after moving `id` by `delta` places (clamped). */
export function moveLabel(labels: readonly Label[], id: string, delta: number): string[] {
  const ids = labels.filter((l) => !l.deletedAt).sort((a, b) => a.order - b.order).map((l) => l.id);
  const from = ids.indexOf(id);
  if (from < 0) return ids;
  const to = Math.max(0, Math.min(ids.length - 1, from + delta));
  ids.splice(to, 0, ...ids.splice(from, 1));
  return ids;
}
