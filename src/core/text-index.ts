/**
 * A flat text view of the DOM: the concatenation of all eligible Text nodes
 * under `root`, plus the start offset of each node. Selectors store offsets
 * into this string; anchoring maps offsets back into DOM Ranges.
 *
 * Offsets are UTF-16 code units, half-open [start, end).
 */

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TEXTAREA', 'IFRAME', 'OBJECT']);

/** Elements carrying this attribute (e.g. WWM's own UI host) are excluded. */
export const IGNORE_ATTR = 'data-wwm-ignore';

export interface TextIndex {
  readonly root: Node;
  readonly text: string;
  readonly nodes: readonly Text[];
  /** starts[i] = offset of nodes[i] within `text`. Monotonic non-decreasing. */
  readonly starts: readonly number[];
}

function isSkipped(el: Element): boolean {
  return SKIP_TAGS.has(el.tagName.toUpperCase()) || el.hasAttribute(IGNORE_ATTR);
}

export function buildTextIndex(root: Node): TextIndex {
  const doc = root.ownerDocument ?? (root as Document);
  const nodes: Text[] = [];
  const starts: number[] = [];
  const parts: string[] = [];
  let offset = 0;

  const walker = doc.createTreeWalker(root, 0x1 | 0x4 /* SHOW_ELEMENT | SHOW_TEXT */, {
    acceptNode(node: Node): number {
      if (node.nodeType === 1) {
        // FILTER_REJECT skips the whole subtree; FILTER_SKIP descends.
        return isSkipped(node as Element) ? 2 : 3;
      }
      return 1; // FILTER_ACCEPT for text nodes
    },
  });

  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeType !== 3) continue;
    const t = n as Text;
    nodes.push(t);
    starts.push(offset);
    parts.push(t.data);
    offset += t.data.length;
  }

  return { root, text: parts.join(''), nodes, starts };
}

/** Index of the last node whose start <= offset (binary search). -1 if none. */
function nodeIndexAt(index: TextIndex, offset: number): number {
  let lo = 0;
  let hi = index.starts.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((index.starts[mid] as number) <= offset) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

/** Convert a DOM boundary point into a text offset. */
export function pointToOffset(index: TextIndex, container: Node, offset: number): number {
  if (container.nodeType === 3) {
    const i = index.nodes.indexOf(container as Text);
    if (i >= 0) return (index.starts[i] as number) + Math.min(offset, (container as Text).data.length);
  }
  // Element (or excluded text) boundary: offset = start of the first indexed
  // text node that begins at or after the boundary point.
  const doc = index.root.ownerDocument ?? (index.root as Document);
  const probe = doc.createRange();
  probe.setStart(container, offset);
  probe.collapse(true);
  for (let i = 0; i < index.nodes.length; i++) {
    const node = index.nodes[i] as Text;
    if (probe.comparePoint(node, 0) >= 0) return index.starts[i] as number;
  }
  return index.text.length;
}

export function rangeToOffsets(index: TextIndex, range: Range): { start: number; end: number } {
  const start = pointToOffset(index, range.startContainer, range.startOffset);
  const end = pointToOffset(index, range.endContainer, range.endOffset);
  return { start: Math.min(start, end), end: Math.max(start, end) };
}

/**
 * Map [start, end) back to a DOM Range. Returns null when the index is empty
 * or offsets are out of bounds.
 */
export function offsetsToRange(index: TextIndex, start: number, end: number): Range | null {
  if (index.nodes.length === 0 || start < 0 || end > index.text.length || start > end) return null;
  const doc = index.root.ownerDocument ?? (index.root as Document);

  // Start: prefer the node that *contains* start (not one that ends exactly there).
  let si = nodeIndexAt(index, start);
  while (si < index.nodes.length - 1) {
    const node = index.nodes[si] as Text;
    if (start - (index.starts[si] as number) < node.data.length) break;
    si++;
  }
  // End: prefer the node where end falls inside or at its end.
  let ei = nodeIndexAt(index, end);
  while (ei > 0 && end === (index.starts[ei] as number) && end > start) ei--;

  if (si < 0 || ei < 0) return null;
  const sNode = index.nodes[si] as Text;
  const eNode = index.nodes[ei] as Text;
  const range = doc.createRange();
  range.setStart(sNode, Math.min(start - (index.starts[si] as number), sNode.data.length));
  range.setEnd(eNode, Math.min(end - (index.starts[ei] as number), eNode.data.length));
  return range;
}
