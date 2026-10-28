/**
 * Tiered re-anchoring, Tiers 0–2 (deterministic). Tiers 3–4 (semantic, LLM)
 * live elsewhere and only run when this returns null or `needs-review`.
 *
 *   T0 position  — stored offsets still contain the exact quote and context agrees
 *   T1 quote     — exact quote found elsewhere; disambiguate by context + position
 *   T2 fuzzy     — approximate match (Myers bit-parallel), scored by quote/context/position
 *
 * Design rule (AGENTS.md §6.4): a wrong anchor is worse than an orphan. When
 * in doubt, return `needs-review` or null. See docs/design/anchoring.md.
 */
import search from 'approx-string-match';
import { getSelector, type AnchorMethod, type AnchorStatus, type Selector } from './types';

export interface AnchorMatch {
  start: number;
  end: number;
  status: Exclude<AnchorStatus, 'orphaned'>;
  method: AnchorMethod;
  /** Combined score in [0, 1]. */
  confidence: number;
  /** Per-component scores, useful for debugging and the benchmark. */
  scores: { quote: number; prefix: number; suffix: number; position: number };
}

export interface AnchorOptions {
  /** Max edit errors as a fraction of quote length for T2. */
  maxErrorRatio: number;
  /** T2: quote similarity at/above which a match is auto-accepted as `moved`. */
  fuzzyAcceptQuote: number;
  /** T2: minimum mean context similarity for auto-accept. */
  fuzzyAcceptContext: number;
  /** T2: quote similarity at/above which a match is offered as `needs-review`. */
  fuzzyReviewQuote: number;
  /** T1/T2: if the top two distinct candidates are closer than this, ask the user. */
  ambiguityMargin: number;
  /** T1: mean context similarity at/above which an exact hit counts as `anchored`. */
  exactContextAnchored: number;
  /** Cap on exact-occurrence candidates considered in T1. */
  maxExactCandidates: number;
}

export const DEFAULT_ANCHOR_OPTIONS: AnchorOptions = {
  maxErrorRatio: 0.3,
  fuzzyAcceptQuote: 0.9,
  fuzzyAcceptContext: 0.5,
  fuzzyReviewQuote: 0.6,
  ambiguityMargin: 0.03,
  exactContextAnchored: 0.75,
  maxExactCandidates: 1000,
};

/** Quotes shorter than this (trimmed) are too generic to trust without context. */
const MIN_DISTINCTIVE_QUOTE = 20;

const W = { quote: 50, prefix: 20, suffix: 20, position: 2 } as const;
const W_SUM = W.quote + W.prefix + W.suffix + W.position;

/** Similarity of `pattern` to its best approximate occurrence in `text` (0..1). */
export function textSimilarity(text: string, pattern: string): number {
  if (pattern.length === 0) return 1;
  if (text.length === 0) return 0;
  const matches = search(text, pattern, pattern.length);
  const best = matches[0];
  if (!best) return 0;
  return 1 - best.errors / pattern.length;
}

/** Characters immediately around a candidate that must match for `adjacentContextIntact`. */
const ADJACENT_CONTEXT_CHARS = 8;

/**
 * True if the characters right before/after the candidate equal the nearest
 * part of the stored prefix/suffix (sides with no stored context are ignored).
 */
export function adjacentContextIntact(
  text: string,
  c: { start: number; end: number },
  prefix: string,
  suffix: string,
  n = ADJACENT_CONTEXT_CHARS,
): boolean {
  const kp = Math.min(n, prefix.length);
  const ks = Math.min(n, suffix.length);
  const before = kp === 0 || text.slice(c.start - kp, c.start) === prefix.slice(prefix.length - kp);
  const after = ks === 0 || text.slice(c.end, c.end + ks) === suffix.slice(0, ks);
  return before && after;
}

const WORD_CHAR = /[\p{L}\p{N}_]/u;
/** Max characters a fuzzy boundary may be extended to reach a word boundary. */
const MAX_SNAP = 24;

/**
 * Approximate matching can start/end mid-word (e.g. "dee|p neural network").
 * Extend each boundary outward to the nearest word boundary, within MAX_SNAP.
 */
export function snapToWordBoundaries(text: string, start: number, end: number): { start: number; end: number } {
  const isWord = (i: number): boolean => i >= 0 && i < text.length && WORD_CHAR.test(text[i]!);
  let s = start;
  if (isWord(s) && isWord(s - 1)) {
    let k = s;
    while (k > 0 && start - k < MAX_SNAP && isWord(k - 1)) k--;
    if (!isWord(k - 1)) s = k;
  }
  let e = end;
  if (isWord(e - 1) && isWord(e)) {
    let k = e;
    while (k < text.length && k - end < MAX_SNAP && isWord(k)) k++;
    if (!isWord(k)) e = k;
  }
  return { start: s, end: e };
}

interface Candidate {
  start: number;
  end: number;
  quoteScore: number;
}

function scoreCandidate(
  text: string,
  c: Candidate,
  prefix: string,
  suffix: string,
  hint: number | undefined,
): AnchorMatch['scores'] & { total: number } {
  const prefixScore = textSimilarity(text.slice(Math.max(0, c.start - prefix.length), c.start), prefix);
  const suffixScore = textSimilarity(text.slice(c.end, c.end + suffix.length), suffix);
  const positionScore = hint === undefined || text.length === 0 ? 1 : 1 - Math.abs(c.start - hint) / text.length;
  const total =
    (W.quote * c.quoteScore + W.prefix * prefixScore + W.suffix * suffixScore + W.position * positionScore) / W_SUM;
  return { quote: c.quoteScore, prefix: prefixScore, suffix: suffixScore, position: positionScore, total };
}

function contextMean(s: { prefix: number; suffix: number }, prefix: string, suffix: string): number {
  // Missing context (start/end of document) should not penalize.
  const parts: number[] = [];
  if (prefix.length > 0) parts.push(s.prefix);
  if (suffix.length > 0) parts.push(s.suffix);
  return parts.length === 0 ? 1 : parts.reduce((a, b) => a + b, 0) / parts.length;
}

function rank(
  text: string,
  cands: Candidate[],
  prefix: string,
  suffix: string,
  hint: number | undefined,
): Array<Candidate & { s: ReturnType<typeof scoreCandidate> }> {
  return cands
    .map((c) => ({ ...c, s: scoreCandidate(text, c, prefix, suffix, hint) }))
    .sort((a, b) => b.s.total - a.s.total);
}

/** True if the best candidate is not clearly better than the next non-overlapping one. */
function isAmbiguous(ranked: Array<Candidate & { s: { total: number } }>, margin: number): boolean {
  const [best, ...rest] = ranked;
  if (!best) return false;
  const rival = rest.find((r) => r.end <= best.start || r.start >= best.end);
  return rival !== undefined && best.s.total - rival.s.total < margin;
}

export function anchorSelectors(
  text: string,
  selectors: readonly Selector[],
  options: Partial<AnchorOptions> = {},
): AnchorMatch | null {
  const opt = { ...DEFAULT_ANCHOR_OPTIONS, ...options };
  const quote = getSelector(selectors, 'TextQuoteSelector');
  const pos = getSelector(selectors, 'TextPositionSelector');
  if (!quote || quote.exact.length === 0) return null; // position-only targets are not trusted
  const { exact, prefix, suffix } = quote;
  const hint = pos?.start;

  const build = (
    c: Candidate & { s: ReturnType<typeof scoreCandidate> },
    status: AnchorMatch['status'],
    method: AnchorMethod,
  ): AnchorMatch => ({
    start: c.start,
    end: c.end,
    status,
    method,
    confidence: c.s.total,
    scores: { quote: c.s.quote, prefix: c.s.prefix, suffix: c.s.suffix, position: c.s.position },
  });

  // ---- T0: position -------------------------------------------------------
  if (pos && text.slice(pos.start, pos.end) === exact) {
    const [c] = rank(text, [{ start: pos.start, end: pos.end, quoteScore: 1 }], prefix, suffix, hint);
    if (c && contextMean(c.s, prefix, suffix) >= opt.exactContextAnchored) {
      return build(c, 'anchored', 'position');
    }
  }

  // ---- T1: exact quote ----------------------------------------------------
  const exactCands: Candidate[] = [];
  for (let i = text.indexOf(exact); i !== -1 && exactCands.length < opt.maxExactCandidates; ) {
    exactCands.push({ start: i, end: i + exact.length, quoteScore: 1 });
    i = text.indexOf(exact, i + 1);
  }
  if (exactCands.length > 0) {
    const ranked = rank(text, exactCands, prefix, suffix, hint);
    const best = ranked[0]!;
    if (isAmbiguous(ranked, opt.ambiguityMargin)) return build(best, 'needs-review', 'quote');
    const ctx = contextMean(best.s, prefix, suffix);
    const unique = exactCands.length === 1;
    const longQuote = exact.trim().length >= MIN_DISTINCTIVE_QUOTE;
    // The quote itself is intact: if it is unique and either distinctive or still
    // flanked by its original neighbouring characters, edits further away (e.g. a
    // rewritten previous paragraph leaking into the 32-char prefix) do not make
    // the anchor less correct.
    if (
      ctx >= opt.exactContextAnchored ||
      (unique && (longQuote || adjacentContextIntact(text, best, prefix, suffix)))
    ) {
      return build(best, 'anchored', 'quote');
    }
    // Relocated by context/position heuristics among several copies, or a short unique quote.
    if (longQuote || unique) return build(best, 'moved', 'quote');
    return build(best, 'needs-review', 'quote');
  }

  // ---- T2: fuzzy ----------------------------------------------------------
  const maxErrors = Math.max(1, Math.floor(exact.length * opt.maxErrorRatio));
  const fuzzy = search(text, exact, maxErrors);
  if (fuzzy.length === 0) return null;
  const fuzzyCands: Candidate[] = fuzzy.map((m) => ({
    ...snapToWordBoundaries(text, m.start, m.end),
    quoteScore: 1 - m.errors / exact.length,
  }));
  const ranked = rank(text, fuzzyCands, prefix, suffix, hint);
  const best = ranked[0]!;
  if (best.s.quote < opt.fuzzyReviewQuote) return null;
  if (
    best.s.quote >= opt.fuzzyAcceptQuote &&
    contextMean(best.s, prefix, suffix) >= opt.fuzzyAcceptContext &&
    !isAmbiguous(ranked, opt.ambiguityMargin)
  ) {
    return build(best, 'moved', 'fuzzy');
  }
  return build(best, 'needs-review', 'fuzzy');
}
