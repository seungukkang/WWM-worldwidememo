import { describe, expect, it } from 'vitest';
import { buildTextIndex, offsetsToRange, rangeToOffsets } from '../../src/core/text-index';
import { htmlDoc } from '../helpers';

describe('text index', () => {
  it('concatenates text nodes and skips script/style/ignored subtrees', () => {
    const doc = htmlDoc(
      '<p>Hello <b>wide</b> world</p><script>bad()</script><style>.x{}</style><div data-wwm-ignore>ui</div><p>!</p>',
    );
    const index = buildTextIndex(doc.body);
    expect(index.text).toBe('Hello wide world!');
    expect(index.starts).toEqual([0, 6, 10, 16]);
  });

  it('round-trips offsets ↔ Range across element boundaries', () => {
    const doc = htmlDoc('<p>Hello <b>wide</b> world</p>');
    const index = buildTextIndex(doc.body);
    const start = index.text.indexOf('lo w');
    const end = index.text.indexOf('world') + 1; // covers "lo wide w"
    const range = offsetsToRange(index, start, end)!;
    expect(range.toString()).toBe('lo wide w');
    expect(rangeToOffsets(index, range)).toEqual({ start, end });
  });

  it('maps element-container boundaries to the next text node', () => {
    const doc = htmlDoc('<p>ab</p><p>cd</p>');
    const index = buildTextIndex(doc.body);
    const second = doc.body.children[1]!;
    const range = doc.createRange();
    range.setStart(second, 0);
    range.setEnd(second, 1);
    expect(rangeToOffsets(index, range)).toEqual({ start: 2, end: 4 });
  });

  it('places a range ending exactly at a node boundary inside the earlier node', () => {
    const doc = htmlDoc('<p>abc</p><p>def</p>');
    const index = buildTextIndex(doc.body);
    const range = offsetsToRange(index, 0, 3)!;
    expect(range.endContainer.textContent).toBe('abc');
    expect(range.toString()).toBe('abc');
  });

  it('rejects out-of-bounds offsets', () => {
    const index = buildTextIndex(htmlDoc('<p>abc</p>').body);
    expect(offsetsToRange(index, 2, 10)).toBeNull();
    expect(offsetsToRange(index, -1, 1)).toBeNull();
  });
});
