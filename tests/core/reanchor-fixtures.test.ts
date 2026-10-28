/**
 * Regression suite: annotate v1, re-anchor on v2.
 * Add a new case here (with fixture edits) whenever a real-world failure is found.
 */
import { describe, expect, it } from 'vitest';
import { anchorSelectors } from '../../src/core/anchor';
import { offsetsToRange } from '../../src/core/text-index';
import { annotate, indexOf, mountFixture, parseFixture } from '../helpers';

const v1 = indexOf(parseFixture('article-v1.html'));
const v2 = indexOf(mountFixture('article-v2.html'));

const reanchor = (quote: string, occurrence = 0) => anchorSelectors(v2.text, annotate(v1, quote, occurrence));

describe('re-anchoring article v1 → v2', () => {
  it('excludes <script> text from the index', () => {
    expect(v1.text).not.toContain('must not be indexed');
  });

  it('A1: same text split by new inline markup + shifted offsets → anchored', () => {
    const quote = 'forward process와, 이를 거꾸로 되돌리는 reverse process';
    const m = reanchor(quote)!;
    expect(m.status).toBe('anchored');
    expect(offsetsToRange(v2, m.start, m.end)!.toString()).toBe(quote);
  });

  it('A2: one word inserted → fuzzy, lands on the edited sentence', () => {
    const m = reanchor('parameterized by a neural network that predicts the noise')!;
    expect(m.method).toBe('fuzzy');
    expect(v2.text.slice(m.start, m.end)).toContain('deep neural network');
  });

  it('A3: sentence fully rewritten → never auto-accepted (left for semantic/LLM tiers)', () => {
    const m = reanchor('네트워크는 각 noise level에서 데이터 분포의 score를 추정한다');
    expect(m === null || m.status === 'needs-review').toBe(true);
  });

  it('A4: unchanged sentence → anchored', () => {
    expect(reanchor('Sampling is slow because it requires hundreds of network evaluations.')!.status).toBe('anchored');
  });

  it('A5: deleted paragraph → orphan (null)', () => {
    expect(reanchor('모든 생성 모델은 결국 diffusion으로 수렴한다')).toBeNull();
  });

  it('A6: repeated phrase keeps its original occurrence', () => {
    const m = reanchor('the model', 1)!;
    const second = v2.text.indexOf('the model', v2.text.indexOf('the model') + 1);
    expect(m.start).toBe(second);
    expect(m.status).toBe('anchored');
  });
});
