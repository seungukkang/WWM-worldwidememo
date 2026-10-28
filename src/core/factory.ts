import { SCHEMA_VERSION, type Annotation, type AnnotationStyle, type Selector } from './types';

export interface NewAnnotationInput {
  pageKey: string;
  url: string;
  title?: string;
  selectors: Selector[];
  context?: string;
  style: AnnotationStyle;
  note?: string;
}

export function createAnnotation(input: NewAnnotationInput, now = new Date()): Annotation {
  const ts = now.toISOString();
  const a: Annotation = {
    id: crypto.randomUUID(),
    schemaVersion: SCHEMA_VERSION,
    pageKey: input.pageKey,
    url: input.url,
    createdAt: ts,
    updatedAt: ts,
    target: { selectors: input.selectors },
    style: input.style,
    anchor: { status: 'anchored', method: 'position', confidence: 1, checkedAt: ts },
  };
  if (input.title !== undefined) a.title = input.title;
  if (input.context !== undefined) a.target.context = input.context;
  if (input.note !== undefined && input.note.trim() !== '') a.note = input.note;
  return a;
}
