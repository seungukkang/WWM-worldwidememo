import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describeOffsets } from '../src/core/selectors';
import { buildTextIndex, type TextIndex } from '../src/core/text-index';
import type { Selector } from '../src/core/types';

/**
 * Note: happy-dom only fully supports Range on the global `document`
 * (Range.toString() is empty for DOMParser documents), so fixtures that need
 * Ranges are mounted into the global document. Use `parseFixture` when only
 * the text index is needed (e.g. the "before" version of a page).
 */
export function readFixture(name: string): string {
  return readFileSync(join(__dirname, 'fixtures', 'pages', name), 'utf8');
}

/** Parse a fixture into a detached Document (text index only; no Range ops). */
export function parseFixture(name: string): Document {
  return new DOMParser().parseFromString(readFixture(name), 'text/html');
}

/** Mount a fixture's <body> into the global document (Range ops supported). */
export function mountFixture(name: string): Document {
  document.body.innerHTML = parseFixture(name).body.innerHTML;
  return document;
}

/** Mount an HTML snippet into the global document body. */
export function htmlDoc(body: string): Document {
  document.body.innerHTML = body;
  return document;
}

/** Create selectors for the n-th occurrence of `quote` in the document's text index. */
export function annotate(index: TextIndex, quote: string, occurrence = 0): Selector[] {
  let at = -1;
  for (let i = 0; i <= occurrence; i++) {
    at = index.text.indexOf(quote, at + 1);
    if (at === -1) throw new Error(`quote not found (occurrence ${i}): ${quote}`);
  }
  const target = describeOffsets(index, at, at + quote.length);
  if (!target) throw new Error('empty target');
  return target.selectors;
}

export function indexOf(doc: Document): TextIndex {
  return buildTextIndex(doc.body);
}
