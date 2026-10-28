/**
 * Style edits from the annotation popover. Pure, so the rules are testable:
 * a color replaces the current one (or removes it when clicked again);
 * underline/bold toggle. An annotation must stay visible: removing the last
 * style of an annotation without a note is refused (Delete removes it).
 */
import type { AnnotationStyle, HighlightColor } from './types';

export type StyleChange = { highlight: HighlightColor } | { underline: true } | { bold: true };

export function hasVisibleStyle(style: AnnotationStyle): boolean {
  return Boolean(style.highlight || style.underline || style.bold);
}

/** The style after applying `change`, or null if the result would leave nothing to show. */
export function toggleStyle(style: AnnotationStyle, change: StyleChange, hasNote: boolean): AnnotationStyle | null {
  const next: AnnotationStyle = { ...style };
  if ('highlight' in change) {
    if (next.highlight === change.highlight) delete next.highlight;
    else next.highlight = change.highlight;
  } else if ('underline' in change) {
    if (next.underline) delete next.underline;
    else next.underline = true;
  } else {
    if (next.bold) delete next.bold;
    else next.bold = true;
  }
  return hasVisibleStyle(next) || hasNote ? next : null;
}
