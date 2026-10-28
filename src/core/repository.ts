/**
 * Annotation repository over a minimal async key-value store.
 * In the extension, only the background service worker instantiates this
 * (single writer, AGENTS.md §5). Tests use MemoryKV.
 *
 * Keys:
 *   wwm:page:<pageKey>  → PageRecord
 *   wwm:pages           → string[] (index of pageKeys)
 *   wwm:labels          → Label[] (including tombstones)
 *   wwm:meta            → { schemaVersion }
 */
import { SCHEMA_VERSION, type Annotation, type Label, type PageRecord } from './types';

export interface KVStore {
  get<T>(key: string): Promise<T | undefined>;
  set(entries: Record<string, unknown>): Promise<void>;
  remove(keys: string[]): Promise<void>;
}

export class MemoryKV implements KVStore {
  private readonly map = new Map<string, unknown>();
  async get<T>(key: string): Promise<T | undefined> {
    const v = this.map.get(key);
    return v === undefined ? undefined : (structuredClone(v) as T);
  }
  async set(entries: Record<string, unknown>): Promise<void> {
    for (const [k, v] of Object.entries(entries)) this.map.set(k, structuredClone(v));
  }
  async remove(keys: string[]): Promise<void> {
    for (const k of keys) this.map.delete(k);
  }
}

export const PAGE_PREFIX = 'wwm:page:';
export const PAGES_KEY = 'wwm:pages';
export const LABELS_KEY = 'wwm:labels';
export const META_KEY = 'wwm:meta';

export class AnnotationRepository {
  /** Serializes writes so read-modify-write cycles never interleave. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly kv: KVStore) {}

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  async getPage(pageKey: string): Promise<PageRecord | undefined> {
    return this.kv.get<PageRecord>(PAGE_PREFIX + pageKey);
  }

  /** Live (non-deleted) annotations for a page. */
  async list(pageKey: string): Promise<Annotation[]> {
    const page = await this.getPage(pageKey);
    return (page?.annotations ?? []).filter((a) => !a.deletedAt);
  }

  async listPages(): Promise<PageRecord[]> {
    const keys = (await this.kv.get<string[]>(PAGES_KEY)) ?? [];
    const pages = await Promise.all(keys.map((k) => this.getPage(k)));
    return pages
      .filter((p): p is PageRecord => p !== undefined)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  upsert(annotation: Annotation): Promise<Annotation> {
    return this.exclusive(async () => {
      const now = new Date().toISOString();
      const key = PAGE_PREFIX + annotation.pageKey;
      const page: PageRecord = (await this.kv.get<PageRecord>(key)) ?? {
        pageKey: annotation.pageKey,
        url: annotation.url,
        updatedAt: now,
        annotations: [],
      };
      if (annotation.title !== undefined) page.title = annotation.title;
      const idx = page.annotations.findIndex((a) => a.id === annotation.id);
      if (idx >= 0) page.annotations[idx] = annotation;
      else page.annotations.push(annotation);
      page.updatedAt = now;

      const pages = (await this.kv.get<string[]>(PAGES_KEY)) ?? [];
      const writes: Record<string, unknown> = { [key]: page, [META_KEY]: { schemaVersion: SCHEMA_VERSION } };
      if (!pages.includes(annotation.pageKey)) writes[PAGES_KEY] = [...pages, annotation.pageKey];
      await this.kv.set(writes);
      return annotation;
    });
  }

  /** Soft delete (tombstone) so a future sync can propagate deletions. */
  remove(pageKey: string, id: string): Promise<boolean> {
    return this.exclusive(async () => {
      const key = PAGE_PREFIX + pageKey;
      const page = await this.kv.get<PageRecord>(key);
      const a = page?.annotations.find((x) => x.id === id);
      if (!page || !a || a.deletedAt) return false;
      const now = new Date().toISOString();
      a.deletedAt = now;
      a.updatedAt = now;
      page.updatedAt = now;
      await this.kv.set({ [key]: page });
      return true;
    });
  }

  async exportAll(): Promise<PageRecord[]> {
    return this.listPages();
  }

  // -- labels ---------------------------------------------------------------

  /** Live labels in the user's order (`includeDeleted` for export). */
  async listLabels(includeDeleted = false): Promise<Label[]> {
    const labels = (await this.kv.get<Label[]>(LABELS_KEY)) ?? [];
    return labels.filter((l) => includeDeleted || !l.deletedAt).sort((a, b) => a.order - b.order);
  }

  /** Create or replace a label (rename, recolor, undo a delete by clearing `deletedAt`). */
  upsertLabel(label: Label): Promise<Label> {
    return this.exclusive(async () => {
      const labels = (await this.kv.get<Label[]>(LABELS_KEY)) ?? [];
      const i = labels.findIndex((l) => l.id === label.id);
      if (i >= 0) labels[i] = label;
      else labels.push(label);
      await this.kv.set({ [LABELS_KEY]: labels });
      return label;
    });
  }

  /** Tombstone a label; pages keep its id so the delete can be undone. */
  removeLabel(id: string, now: string): Promise<boolean> {
    return this.exclusive(async () => {
      const labels = (await this.kv.get<Label[]>(LABELS_KEY)) ?? [];
      const label = labels.find((l) => l.id === id);
      if (!label || label.deletedAt) return false;
      label.deletedAt = now;
      label.updatedAt = now;
      await this.kv.set({ [LABELS_KEY]: labels });
      return true;
    });
  }

  /** Set label order to the order of `ids` (labels not listed keep theirs, after these). */
  reorderLabels(ids: string[], now: string): Promise<void> {
    return this.exclusive(async () => {
      const labels = (await this.kv.get<Label[]>(LABELS_KEY)) ?? [];
      const rank = new Map(ids.map((id, i) => [id, i]));
      const rest = labels.filter((l) => !rank.has(l.id)).sort((a, b) => a.order - b.order);
      for (const l of labels) {
        const r = rank.get(l.id) ?? ids.length + rest.indexOf(l);
        if (l.order !== r) {
          l.order = r;
          l.updatedAt = now;
        }
      }
      await this.kv.set({ [LABELS_KEY]: labels });
    });
  }

  /** Replace a page's labels. Does not touch `updatedAt` (lists sort by annotation edits). */
  setPageLabels(pageKey: string, labelIds: string[]): Promise<boolean> {
    return this.exclusive(async () => {
      const key = PAGE_PREFIX + pageKey;
      const page = await this.kv.get<PageRecord>(key);
      if (!page) return false;
      const unique = [...new Set(labelIds)];
      if (unique.length > 0) page.labelIds = unique;
      else delete page.labelIds;
      await this.kv.set({ [key]: page });
      return true;
    });
  }
}
