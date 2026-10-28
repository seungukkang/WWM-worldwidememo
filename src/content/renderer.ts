/**
 * Renders annotations with the CSS Custom Highlight API — no DOM mutation of
 * the host page (ADR-0004). Styles live in content.css as ::highlight(wwm-*).
 *
 * Limitation: ::highlight() only supports a subset of properties
 * (color, background-color, text-decoration, text-shadow, ...). "Bold" is
 * approximated with text-shadow; see docs/design/rendering.md.
 */
import type { Annotation } from '../core/types';

export const HIGHLIGHT_NAMES = [
  'wwm-hl-yellow',
  'wwm-hl-green',
  'wwm-hl-blue',
  'wwm-hl-pink',
  'wwm-underline',
  'wwm-bold',
  'wwm-note',
  'wwm-review',
  'wwm-flash',
] as const;
type HighlightName = (typeof HIGHLIGHT_NAMES)[number];

export interface RenderEntry {
  annotation: Annotation;
  range: Range;
}

export function isSupported(): boolean {
  return typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined';
}

export class HighlightRenderer {
  private entries = new Map<string, RenderEntry>();
  private readonly layers = new Map<HighlightName, Highlight>();

  constructor() {
    if (!isSupported()) return;
    for (const name of HIGHLIGHT_NAMES) {
      const h = new Highlight();
      // Later names paint on top: flash > review > note > bold > underline > colors.
      h.priority = HIGHLIGHT_NAMES.indexOf(name);
      this.layers.set(name, h);
      CSS.highlights.set(name, h);
    }
  }

  render(entries: RenderEntry[]): void {
    this.entries = new Map(entries.map((e) => [e.annotation.id, e]));
    for (const h of this.layers.values()) h.clear();
    for (const { annotation: a, range } of entries) {
      const s = a.style;
      if (s.highlight) this.layers.get(`wwm-hl-${s.highlight}`)?.add(range);
      if (s.underline) this.layers.get('wwm-underline')?.add(range);
      if (s.bold) this.layers.get('wwm-bold')?.add(range);
      if (a.note && !s.underline) this.layers.get('wwm-note')?.add(range);
      if (a.anchor?.status === 'needs-review') this.layers.get('wwm-review')?.add(range);
    }
  }

  get(id: string): RenderEntry | undefined {
    return this.entries.get(id);
  }

  all(): RenderEntry[] {
    return [...this.entries.values()];
  }

  /** Return the id of the annotation under a viewport point, if any. */
  hitTest(x: number, y: number): string | undefined {
    const point = caretPoint(x, y);
    if (!point) return undefined;
    let hit: RenderEntry | undefined;
    for (const e of this.entries.values()) {
      try {
        if (!e.range.isPointInRange(point.node, point.offset)) continue;
      } catch {
        continue; // range belongs to a detached subtree
      }
      // Prefer the innermost (shortest) annotation when they overlap.
      if (!hit || e.range.toString().length < hit.range.toString().length) hit = e;
    }
    return hit?.annotation.id;
  }

  flash(id: string, ms = 1200): void {
    const e = this.entries.get(id);
    const layer = this.layers.get('wwm-flash');
    if (!e || !layer) return;
    layer.add(e.range);
    setTimeout(() => layer.delete(e.range), ms);
  }

  destroy(): void {
    for (const name of HIGHLIGHT_NAMES) CSS.highlights?.delete(name);
    this.layers.clear();
    this.entries.clear();
  }
}

function caretPoint(x: number, y: number): { node: Node; offset: number } | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  if (typeof doc.caretPositionFromPoint === 'function') {
    const p = doc.caretPositionFromPoint(x, y);
    return p ? { node: p.offsetNode, offset: p.offset } : null;
  }
  const r = document.caretRangeFromPoint?.(x, y);
  return r ? { node: r.startContainer, offset: r.startOffset } : null;
}
