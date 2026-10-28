import { CONTEXT_SNAPSHOT_CHARS, QUOTE_CONTEXT_CHARS, type Selector } from './types';
import { rangeToOffsets, type TextIndex } from './text-index';

export interface DescribedTarget {
  selectors: Selector[];
  context: string;
}

/**
 * Describe a text range as W3C selectors plus a bounded context snapshot.
 * Returns null for empty / whitespace-only selections.
 */
export function describeOffsets(index: TextIndex, start: number, end: number): DescribedTarget | null {
  const exact = index.text.slice(start, end);
  if (exact.trim().length === 0) return null;

  const prefix = index.text.slice(Math.max(0, start - QUOTE_CONTEXT_CHARS), start);
  const suffix = index.text.slice(end, end + QUOTE_CONTEXT_CHARS);

  const pad = Math.max(0, Math.floor((CONTEXT_SNAPSHOT_CHARS - exact.length) / 2));
  const context = index.text.slice(Math.max(0, start - pad), Math.min(index.text.length, end + pad));

  return {
    selectors: [
      { type: 'TextQuoteSelector', exact, prefix, suffix },
      { type: 'TextPositionSelector', start, end },
    ],
    context,
  };
}

export function describeRange(index: TextIndex, range: Range): DescribedTarget | null {
  const { start, end } = rangeToOffsets(index, range);
  if (end <= start) return null;
  return describeOffsets(index, start, end);
}
