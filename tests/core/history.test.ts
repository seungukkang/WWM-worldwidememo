import { describe, expect, it } from 'vitest';
import {
  HISTORY_LIMIT,
  HistoryStore,
  recordEdit,
  redoState,
  takeRedo,
  takeUndo,
  undoState,
  type HistoryEntry,
  type PageHistory,
} from '../../src/core/history';
import { MemoryKV } from '../../src/core/repository';
import type { Annotation } from '../../src/core/types';

const ann = (patch: Partial<Annotation> = {}): Annotation => ({
  id: 'a1',
  schemaVersion: 1,
  pageKey: 'https://example.com/',
  url: 'https://example.com/',
  createdAt: '2026-10-28T00:00:00.000Z',
  updatedAt: '2026-10-28T00:00:00.000Z',
  target: { selectors: [{ type: 'TextQuoteSelector', exact: 'hello', prefix: '', suffix: '' }] },
  style: { highlight: 'yellow' },
  ...patch,
});

const empty: PageHistory = { undo: [], redo: [] };
const NOW = '2026-10-28T12:00:00.000Z';

describe('history stack', () => {
  it('undo then redo walks the same entry back and forth', () => {
    const e: HistoryEntry = { action: 'style', before: ann(), after: ann({ style: { highlight: 'blue' } }) };
    const h1 = recordEdit(empty, e);
    const u = takeUndo(h1)!;
    expect(u.entry).toBe(e);
    expect(u.history).toEqual({ undo: [], redo: [e] });
    const r = takeRedo(u.history)!;
    expect(r.history).toEqual({ undo: [e], redo: [] });
    expect(takeUndo(empty)).toBeNull();
    expect(takeRedo(empty)).toBeNull();
  });

  it('a new edit after undo drops the redo branch', () => {
    const e1: HistoryEntry = { action: 'create', before: null, after: ann() };
    const e2: HistoryEntry = { action: 'note', before: ann(), after: ann({ note: 'x' }) };
    const undone = takeUndo(recordEdit(empty, e1))!.history;
    expect(recordEdit(undone, e2)).toEqual({ undo: [e2], redo: [] });
  });

  it('keeps at most HISTORY_LIMIT entries', () => {
    let h = empty;
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) h = recordEdit(h, { action: 'style', before: ann(), after: ann() });
    expect(h.undo).toHaveLength(HISTORY_LIMIT);
  });
});

describe('undo/redo states', () => {
  it('undoing an edit restores the previous version (e.g. an overwritten note)', () => {
    const e: HistoryEntry = { action: 'note', before: ann({ note: 'original' }), after: ann({ note: 'rewritten' }) };
    expect(undoState(e, NOW)).toMatchObject({ note: 'original', updatedAt: NOW });
    expect(redoState(e, NOW)).toMatchObject({ note: 'rewritten', updatedAt: NOW });
  });

  it('undoing a create tombstones it; undoing a delete revives it', () => {
    const created: HistoryEntry = { action: 'create', before: null, after: ann() };
    expect(undoState(created, NOW).deletedAt).toBe(NOW);
    const deleted: HistoryEntry = { action: 'delete', before: ann(), after: ann({ deletedAt: NOW }) };
    expect(undoState(deleted, NOW).deletedAt).toBeUndefined();
    expect(redoState(deleted, NOW).deletedAt).toBe(NOW);
  });
});

describe('HistoryStore', () => {
  it('keeps one history per page and serializes concurrent updates', async () => {
    const store = new HistoryStore(new MemoryKV());
    const e: HistoryEntry = { action: 'create', before: null, after: ann() };
    await Promise.all([
      store.update('p1', (h) => ({ history: recordEdit(h, e), result: undefined })),
      store.update('p1', (h) => ({ history: recordEdit(h, e), result: undefined })),
    ]);
    expect((await store.get('p1')).undo).toHaveLength(2);
    expect((await store.get('p2')).undo).toHaveLength(0);
  });
});
