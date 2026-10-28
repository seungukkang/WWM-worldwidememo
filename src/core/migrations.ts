/**
 * Storage schema migrations, run once by the background service worker on
 * start-up (docs/design/data-model.md §5). Before migrating, the existing
 * pages are backed up locally under `wwm:backup:v<from>`.
 */
import { META_KEY, PAGE_PREFIX, PAGES_KEY, type KVStore } from './repository';
import { SCHEMA_VERSION, type PageRecord } from './types';

/** v1 → v2: page labels were added (optional field); annotations get the new version. */
export function migratePageV1toV2(page: PageRecord): PageRecord {
  return { ...page, annotations: page.annotations.map((a) => ({ ...a, schemaVersion: 2 })) };
}

export interface MigrationResult {
  from: number;
  to: number;
  pages: number;
}

export async function migrateStorage(kv: KVStore, now: string = new Date().toISOString()): Promise<MigrationResult> {
  const meta = await kv.get<{ schemaVersion?: number }>(META_KEY);
  const keys = (await kv.get<string[]>(PAGES_KEY)) ?? [];
  // No meta and no pages: a fresh install, already current.
  const from = meta?.schemaVersion ?? (keys.length > 0 ? 1 : SCHEMA_VERSION);
  if (from >= SCHEMA_VERSION) {
    if (!meta) await kv.set({ [META_KEY]: { schemaVersion: SCHEMA_VERSION } });
    return { from, to: from, pages: 0 };
  }

  const pages = (await Promise.all(keys.map((k) => kv.get<PageRecord>(PAGE_PREFIX + k)))).filter(
    (p): p is PageRecord => p !== undefined,
  );
  await kv.set({ [`wwm:backup:v${from}`]: { createdAt: now, pages } });

  const writes: Record<string, unknown> = {};
  for (const page of pages) {
    let migrated = page;
    if (from < 2) migrated = migratePageV1toV2(migrated);
    writes[PAGE_PREFIX + page.pageKey] = migrated;
  }
  writes[META_KEY] = { schemaVersion: SCHEMA_VERSION };
  await kv.set(writes);
  return { from, to: SCHEMA_VERSION, pages: pages.length };
}
