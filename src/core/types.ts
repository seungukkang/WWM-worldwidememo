/**
 * Core data model. Selector shapes follow the W3C Web Annotation Data Model
 * (https://www.w3.org/TR/annotation-model/) so exports stay interoperable.
 * See docs/design/data-model.md.
 */

export const SCHEMA_VERSION = 1 as const;

export interface TextQuoteSelector {
  type: 'TextQuoteSelector';
  exact: string;
  prefix: string;
  suffix: string;
}

export interface TextPositionSelector {
  type: 'TextPositionSelector';
  /** Half-open [start, end) in UTF-16 code units over the page text index. */
  start: number;
  end: number;
}

/** Phase 5. Kept here so the union is stable from day one. */
export interface ImageSelector {
  type: 'ImageSelector';
  src: string;
  alt: string;
  /** 64-bit dHash as 16 hex chars, if computed. */
  dhash?: string;
  /** Normalized [0,1] region within the image; omitted = whole image. */
  region?: { x: number; y: number; w: number; h: number };
}

export type Selector = TextQuoteSelector | TextPositionSelector | ImageSelector;

export type HighlightColor = 'yellow' | 'green' | 'blue' | 'pink';

export interface AnnotationStyle {
  highlight?: HighlightColor;
  underline?: boolean;
  bold?: boolean;
}

/**
 * Anchor lifecycle. `anchored`/`moved` render without asking; `needs-review`
 * renders dashed and waits for user confirmation; `orphaned` does not render.
 */
export type AnchorStatus = 'anchored' | 'moved' | 'needs-review' | 'orphaned';

/** Which tier produced the current anchor. See docs/design/anchoring.md. */
export type AnchorMethod = 'position' | 'quote' | 'fuzzy' | 'semantic' | 'llm' | 'manual';

export interface AnchorState {
  status: AnchorStatus;
  method?: AnchorMethod;
  /** 0..1, higher is more certain. */
  confidence?: number;
  checkedAt: string;
}

export interface Annotation {
  id: string;
  schemaVersion: typeof SCHEMA_VERSION;
  pageKey: string;
  url: string;
  title?: string;
  createdAt: string;
  updatedAt: string;
  target: {
    selectors: Selector[];
    /**
     * Short text snapshot around the quote (bounded, see CONTEXT_SNAPSHOT_CHARS)
     * used for review diffs and semantic re-anchoring. Never the full page.
     */
    context?: string;
  };
  style: AnnotationStyle;
  /** User-authored note. Never generated or modified by an LLM (AGENTS.md §6). */
  note?: string;
  anchor?: AnchorState;
  /** Soft delete for sync (tombstone). */
  deletedAt?: string;
}

export interface PageRecord {
  pageKey: string;
  url: string;
  title?: string;
  updatedAt: string;
  annotations: Annotation[];
}

export const QUOTE_CONTEXT_CHARS = 32;
export const CONTEXT_SNAPSHOT_CHARS = 400;

export function getSelector<T extends Selector['type']>(
  selectors: readonly Selector[],
  type: T,
): Extract<Selector, { type: T }> | undefined {
  return selectors.find((s): s is Extract<Selector, { type: T }> => s.type === type);
}
