import { describe, expect, it } from 'vitest';
import { anchorSelectors, snapToWordBoundaries, textSimilarity } from '../../src/core/anchor';
import type { Selector } from '../../src/core/types';

const sel = (exact: string, prefix: string, suffix: string, start?: number): Selector[] => {
  const s: Selector[] = [{ type: 'TextQuoteSelector', exact, prefix, suffix }];
  if (start !== undefined) s.push({ type: 'TextPositionSelector', start, end: start + exact.length });
  return s;
};

describe('textSimilarity', () => {
  it('is 1 for identical, lower with edits, 0 for empty text', () => {
    expect(textSimilarity('hello world', 'hello world')).toBe(1);
    expect(textSimilarity('hello wurld', 'hello world')).toBeCloseTo(1 - 1 / 11);
    expect(textSimilarity('', 'abc')).toBe(0);
    expect(textSimilarity('abc', '')).toBe(1);
  });
});

describe('anchorSelectors', () => {
  const text = 'Alpha beta gamma. The model is good. Later, the model is distilled. End.';

  it('T0: position still holds the quote → anchored/position', () => {
    const start = text.indexOf('beta gamma');
    const m = anchorSelectors(text, sel('beta gamma', 'Alpha ', '. The model', start))!;
    expect(m).toMatchObject({ status: 'anchored', method: 'position', start });
  });

  it('T1: shifted text → anchored/quote at the new offset', () => {
    const shifted = 'NEW BANNER. ' + text;
    const start = text.indexOf('beta gamma');
    const m = anchorSelectors(shifted, sel('beta gamma', 'Alpha ', '. The model', start))!;
    expect(m.method).toBe('quote');
    expect(m.status).toBe('anchored');
    expect(shifted.slice(m.start, m.end)).toBe('beta gamma');
  });

  it('T1: disambiguates repeated quotes by context', () => {
    const second = text.indexOf('the model');
    const m = anchorSelectors('X' + text, sel('the model', 'Later, ', ' is distilled'))!;
    expect(m.start).toBe(second + 1);
    expect(m.status).toBe('anchored');
  });

  it('T1: short unique quote whose neighbouring paragraph changed → still anchored', () => {
    // Regression (store-asset demo): the 32-char prefix spilled into a rewritten
    // previous paragraph, so mean context dropped and the badge wrongly said "moved".
    const v1 = 'Old paragraph about something else.샘플링할 때는 순수한 노이즈에서 출발해 예측한 노이즈를 제거한다.';
    const v2 = 'A totally rewritten paragraph here!샘플링할 때는 순수한 노이즈에서 출발해 예측한 노이즈를 제거한다.';
    const quote = '순수한 노이즈에서 출발해';
    const at = v1.indexOf(quote);
    const m = anchorSelectors(v2, sel(quote, v1.slice(at - 32, at), v1.slice(at + quote.length, at + quote.length + 32), at))!;
    expect(m.status).toBe('anchored');
  });

  it('T1: identical repeats with no distinguishing context → needs-review', () => {
    const t = 'aa xx bb. aa xx bb.';
    const m = anchorSelectors(t, sel('xx', 'aa ', ' bb'))!;
    expect(m.status).toBe('needs-review');
  });

  it('T2: small edit inside the quote → fuzzy', () => {
    const quote = 'parameterized by a neural network that predicts the noise';
    const v2 = 'The reverse process is parameterized by a deep neural network that predicts the noise added.';
    const m = anchorSelectors(v2, sel(quote, 'The reverse process is ', ' added'))!;
    expect(m.method).toBe('fuzzy');
    expect(['moved', 'needs-review']).toContain(m.status);
    expect(v2.slice(m.start, m.end)).toContain('deep neural network');
  });

  it('T2: fuzzy span never starts or ends mid-word', () => {
    // Regression (store-asset demo): match started at "dee|p neural network".
    const quote = 'A neural network is then trained to predict the noise that was added at each step.';
    const v2 = 'noise remains.A deep neural network is then trained to predict the noise that was injected at every step.At sampling';
    const m = anchorSelectors(v2, sel(quote, 'step until nothing but noise remains.', 'At sampling time, we start'))!;
    const span = v2.slice(m.start, m.end);
    const isWord = (ch: string | undefined): boolean => ch !== undefined && /\w/.test(ch);
    expect(isWord(v2[m.start]) && isWord(v2[m.start - 1])).toBe(false); // not mid-word at start
    expect(isWord(v2[m.end - 1]) && isWord(v2[m.end])).toBe(false); // not mid-word at end
    expect(span).toContain('deep neural network');
    expect(span.endsWith('step.') || span.endsWith('step')).toBe(true);
  });

  it('snapToWordBoundaries extends outward only to whole words', () => {
    const t = 'alpha bravo charlie';
    expect(snapToWordBoundaries(t, 8, 15)).toEqual({ start: 6, end: 19 }); // "avo cha" → "bravo charlie"
    expect(snapToWordBoundaries(t, 6, 11)).toEqual({ start: 6, end: 11 }); // already aligned
    expect(snapToWordBoundaries('한국어 문장 테스트', 1, 6)).toEqual({ start: 0, end: 6 });
  });

  it('returns null when the quote is gone', () => {
    const m = anchorSelectors(text, sel('completely unrelated sentence about kittens', 'x', 'y'));
    expect(m).toBeNull();
  });

  it('does not trust position-only selectors', () => {
    expect(anchorSelectors(text, [{ type: 'TextPositionSelector', start: 0, end: 5 }])).toBeNull();
  });
});
