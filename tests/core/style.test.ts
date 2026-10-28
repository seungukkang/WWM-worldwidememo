import { describe, expect, it } from 'vitest';
import { hasVisibleStyle, toggleStyle } from '../../src/core/style';

describe('toggleStyle', () => {
  it('replaces the highlight color', () => {
    expect(toggleStyle({ highlight: 'yellow' }, { highlight: 'blue' }, false)).toEqual({ highlight: 'blue' });
  });

  it('removes the highlight when its color is clicked again, keeping other styles', () => {
    expect(toggleStyle({ highlight: 'yellow', underline: true }, { highlight: 'yellow' }, false)).toEqual({
      underline: true,
    });
  });

  it('toggles underline and bold independently (combinations allowed)', () => {
    const s = toggleStyle({ highlight: 'pink' }, { underline: true }, false)!;
    expect(s).toEqual({ highlight: 'pink', underline: true });
    expect(toggleStyle(s, { bold: true }, false)).toEqual({ highlight: 'pink', underline: true, bold: true });
    expect(toggleStyle(s, { underline: true }, false)).toEqual({ highlight: 'pink' });
  });

  it('refuses to remove the last style of an annotation without a note', () => {
    expect(toggleStyle({ bold: true }, { bold: true }, false)).toBeNull();
    expect(toggleStyle({ highlight: 'green' }, { highlight: 'green' }, false)).toBeNull();
  });

  it('allows a note-only annotation (the note keeps it visible)', () => {
    const s = toggleStyle({ underline: true }, { underline: true }, true)!;
    expect(hasVisibleStyle(s)).toBe(false);
  });
});
