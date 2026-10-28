import { describe, expect, it } from 'vitest';
import { createAnnotation } from '../../src/core/factory';
import { AnnotationRepository, MemoryKV } from '../../src/core/repository';

const make = (pageKey: string, note?: string) =>
  createAnnotation({
    pageKey,
    url: pageKey,
    selectors: [{ type: 'TextQuoteSelector', exact: 'x', prefix: '', suffix: '' }],
    style: { highlight: 'yellow' },
    ...(note ? { note } : {}),
  });

describe('AnnotationRepository', () => {
  it('upserts, lists per page and indexes pages', async () => {
    const repo = new AnnotationRepository(new MemoryKV());
    const a = make('https://a.com/1');
    await repo.upsert(a);
    await repo.upsert(make('https://b.com/2'));
    expect(await repo.list('https://a.com/1')).toHaveLength(1);
    expect((await repo.listPages()).map((p) => p.pageKey).sort()).toEqual(['https://a.com/1', 'https://b.com/2']);

    await repo.upsert({ ...a, note: 'edited' });
    const [only] = await repo.list('https://a.com/1');
    expect(only?.note).toBe('edited');
  });

  it('soft-deletes with a tombstone', async () => {
    const repo = new AnnotationRepository(new MemoryKV());
    const a = await repo.upsert(make('https://a.com/1'));
    expect(await repo.remove(a.pageKey, a.id)).toBe(true);
    expect(await repo.list(a.pageKey)).toHaveLength(0);
    const page = await repo.getPage(a.pageKey);
    expect(page?.annotations[0]?.deletedAt).toBeTruthy();
    expect(await repo.remove(a.pageKey, a.id)).toBe(false);
  });

  it('serializes concurrent writes (no lost updates)', async () => {
    const repo = new AnnotationRepository(new MemoryKV());
    await Promise.all(Array.from({ length: 20 }, () => repo.upsert(make('https://a.com/1'))));
    expect(await repo.list('https://a.com/1')).toHaveLength(20);
  });

  it('never stores empty notes', () => {
    expect(make('k', '   ').note).toBeUndefined();
  });
});
