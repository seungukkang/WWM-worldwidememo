/**
 * Per-page undo/redo of the user's own edits (create, delete, style, note,
 * confirm position). Each entry keeps the annotation before and after the
 * edit; undo writes `before` back (a created annotation is tombstoned), redo
 * writes `after`. Re-anchoring status updates are not user edits and are never
 * recorded. Only the background service worker uses this (single writer).
 */
import type { KVStore } from './repository';
import type { Annotation } from './types';

export type HistoryAction = 'create' | 'delete' | 'style' | 'note' | 'confirm';

export interface HistoryEntry {
  action: HistoryAction;
  /** null: the annotation did not exist before (create). */
  before: Annotation | null;
  after: Annotation;
}

export interface PageHistory {
  undo: HistoryEntry[];
  redo: HistoryEntry[];
}

export const HISTORY_LIMIT = 50;
const KEY_PREFIX = 'wwm:history:';

const empty = (): PageHistory => ({ undo: [], redo: [] });

/** A new edit: push it and drop the redo branch (like any editor). */
export function recordEdit(h: PageHistory, entry: HistoryEntry, limit = HISTORY_LIMIT): PageHistory {
  return { undo: [...h.undo, entry].slice(-limit), redo: [] };
}

export function takeUndo(h: PageHistory): { entry: HistoryEntry; history: PageHistory } | null {
  const entry = h.undo.at(-1);
  if (!entry) return null;
  return { entry, history: { undo: h.undo.slice(0, -1), redo: [...h.redo, entry] } };
}

export function takeRedo(h: PageHistory): { entry: HistoryEntry; history: PageHistory } | null {
  const entry = h.redo.at(-1);
  if (!entry) return null;
  return { entry, history: { undo: [...h.undo, entry], redo: h.redo.slice(0, -1) } };
}

/** The annotation to write to undo `entry` (a created annotation becomes a tombstone). */
export function undoState(entry: HistoryEntry, now: string): Annotation {
  if (entry.before) return { ...entry.before, updatedAt: now };
  return { ...entry.after, deletedAt: now, updatedAt: now };
}

export function redoState(entry: HistoryEntry, now: string): Annotation {
  return { ...entry.after, updatedAt: now };
}

/** Histories in a key-value store, one key per page, with serialized updates. */
export class HistoryStore {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly kv: KVStore) {}

  async get(pageKey: string): Promise<PageHistory> {
    return (await this.kv.get<PageHistory>(KEY_PREFIX + pageKey)) ?? empty();
  }

  /** Read-modify-write a page's history; `fn` returns the new history and a result. */
  update<T>(pageKey: string, fn: (h: PageHistory) => { history: PageHistory; result: T }): Promise<T> {
    const run = this.queue.then(async () => {
      const { history, result } = fn(await this.get(pageKey));
      await this.kv.set({ [KEY_PREFIX + pageKey]: history });
      return result;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }
}
