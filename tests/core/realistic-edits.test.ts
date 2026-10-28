/**
 * Re-anchoring under the edits that actually happen to documents and sites:
 * a few words replaced or a phrase added inside a long highlight (should
 * follow automatically), and word-level highlights on busy, repetitive pages
 * such as chat apps (must never be moved automatically).
 */
import { describe, expect, it } from 'vitest';
import { anchorSelectors } from '../../src/core/anchor';
import { describeOffsets } from '../../src/core/selectors';
import type { TextIndex } from '../../src/core/text-index';
import type { Selector } from '../../src/core/types';

const textIndex = (text: string): TextIndex => ({ root: document.body, text, nodes: [], starts: [] });

/** Selectors for `quote` as WWM would store them on page `v1` (first occurrence after `after`). */
function annotate(v1: string, quote: string, after = ''): Selector[] {
  const at = v1.indexOf(quote, after ? v1.indexOf(after) : 0);
  if (at < 0) throw new Error(`quote not in v1: ${quote}`);
  return describeOffsets(textIndex(v1), at, at + quote.length)!.selectors;
}

const P1 = 'Diffusion models generate data by learning to reverse a gradual noising process. ';
const Q = 'The reverse process is parameterized by a neural network that predicts the noise added at each step.';
const Q2 = ' Sampling is slow because it requires hundreds of network evaluations.';
const P3 = ' Later work distilled the sampler into a few steps. Score matching offers another view.';
const V1 = P1 + Q + Q2 + P3;

describe('long highlights follow edits when their surroundings confirm the place', () => {
  const cases: Array<[string, string, string, string]> = [
    // [label, quote, v2, text the anchor must cover]
    ['one word replaced', Q, V1.replace('neural', 'deep'), 'parameterized by a deep network'],
    ['two words replaced', Q, V1.replace('neural network', 'deep model'), 'parameterized by a deep model that'],
    [
      'several words replaced',
      Q,
      V1.replace('predicts the noise added', 'estimates the corruption applied'),
      'estimates the corruption applied',
    ],
    [
      'phrase inserted',
      Q,
      V1.replace('neural network', 'neural network, typically a U-Net,'),
      'typically a U-Net, that predicts',
    ],
    [
      'medium quote, one word replaced',
      'predicts the noise added at each step',
      V1.replace('noise added', 'noise injected'),
      'predicts the noise injected at each step',
    ],
  ];

  it.each(cases)('%s → moved/fuzzy on the edited sentence', (_label, quote, v2, covers) => {
    const m = anchorSelectors(v2, annotate(V1, quote));
    expect(m).toMatchObject({ status: 'moved', method: 'fuzzy' });
    expect(v2.slice(m!.start, m!.end)).toContain(covers);
  });

  it('several words replaced and the surroundings rewritten too → asks instead of moving', () => {
    const v2 = (P1.replace('gradual noising', 'step-by-step corruption') + Q + Q2 + P3)
      .replace('predicts the noise added', 'estimates the corruption applied')
      .replace('Sampling is slow', 'Generation takes long');
    const m = anchorSelectors(v2, annotate(V1, Q));
    expect(m?.status).toBe('needs-review');
  });

  it('unchanged sentence moved elsewhere by a reorder → still anchored', () => {
    const v2 = P3.trim() + ' ' + P1 + Q2.trim() + ' ' + Q;
    expect(anchorSelectors(v2, annotate(V1, Q))).toMatchObject({ status: 'anchored', method: 'quote' });
  });
});

describe('short highlights are never moved automatically', () => {
  // A chat app: author/time chrome repeats around every message.
  const head = 'Seunguk Kang 오후 4:12 ';
  const tail = ' 메시지 입력 Seunguk Kang에게 메시지 보내기';
  const msg = (body: string, before = ''): string => before + head + body + tail;

  it('edited word with the same word elsewhere on the page → orphan, not moved', () => {
    const selectors = annotate(msg('WWM test', 'unit test passed '), 'test', 'WWM test');
    expect(anchorSelectors(msg('WWM te(perturbation)st (편집됨)', 'unit test passed '), selectors)).toBeNull();
  });

  it('edited word with the quote only inside another word ("latest") → orphan', () => {
    const selectors = annotate(msg('WWM test', 'Jump to latest messages '), 'test', 'WWM test');
    expect(anchorSelectors(msg('WWM te(perturbation)st (편집됨)', 'Jump to latest messages '), selectors)).toBeNull();
  });

  it('edited word with only a similar word on the page ("best") → orphan, no fuzzy guess', () => {
    const selectors = annotate(msg('WWM test', 'the best way '), 'test', 'WWM test');
    expect(anchorSelectors(msg('WWM te(perturbation)st (편집됨)', 'the best way '), selectors)).toBeNull();
  });

  it('same word in another message sharing the composer chrome after it → asks, never takes it', () => {
    const selectors = annotate(msg('WWM test'), 'test', 'WWM test');
    // The original message is gone; a later message by the same author says "test".
    const v2 = 'Seunguk Kang 오후 4:13 test' + tail;
    expect(anchorSelectors(v2, selectors)?.status).toBe('needs-review');
  });

  it('message only gained an "(edited)" label → still anchored', () => {
    const selectors = annotate(msg('WWM test'), 'test', 'WWM test');
    expect(anchorSelectors(msg('WWM test (편집됨)'), selectors)?.status).toBe('anchored');
  });

  it('new messages above shift the offset → still anchored', () => {
    const selectors = annotate(msg('WWM test'), 'test', 'WWM test');
    const v2 = 'Someone 오후 4:10 hello there' + ' ' + msg('WWM test');
    const m = anchorSelectors(v2, selectors)!;
    expect(m.status).toBe('anchored');
    expect(v2.slice(m.start - 4, m.end)).toBe('WWM test');
  });

  it('short quote in a long document: a word nearby replaced → never moved', () => {
    const quote = 'neural network';
    const v2 = V1.replace('neural network', 'neural networks');
    const m = anchorSelectors(v2, annotate(V1, quote));
    expect(m?.status).not.toBe('moved');
  });
});
