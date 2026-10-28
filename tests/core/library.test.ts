import { describe, expect, it } from 'vitest';
import {
  countPages,
  cycleLabelColor,
  filterPages,
  labelsOfPage,
  moveLabel,
  nextLabelColor,
  pageDisplayTitle,
  pageMatchesQuery,
} from '../../src/core/library';
import { migratePageV1toV2, migrateStorage } from '../../src/core/migrations';
import { AnnotationRepository, MemoryKV } from '../../src/core/repository';
import type { Annotation, Label, PageRecord } from '../../src/core/types';

const ann = (exact: string, patch: Partial<Annotation> = {}): Annotation => ({
  id: crypto.randomUUID(),
  schemaVersion: 2,
  pageKey: 'k',
  url: 'u',
  createdAt: '2026-10-28T00:00:00.000Z',
  updatedAt: '2026-10-28T00:00:00.000Z',
  target: { selectors: [{ type: 'TextQuoteSelector', exact, prefix: '', suffix: '' }] },
  style: { highlight: 'yellow' },
  ...patch,
});

const page = (pageKey: string, updatedAt: string, annotations: Annotation[], patch: Partial<PageRecord> = {}): PageRecord => ({
  pageKey,
  url: pageKey.startsWith('pdf:') ? 'https://arxiv.org/pdf/1' : pageKey,
  updatedAt,
  annotations,
  ...patch,
});

const label = (id: string, order: number, patch: Partial<Label> = {}): Label => ({
  id,
  name: id,
  color: 'blue',
  order,
  createdAt: 'x',
  updatedAt: 'x',
  ...patch,
});

const pages: PageRecord[] = [
  page('https://a.com/diffusion', '2026-10-28T03:00:00Z', [ann('reverse process', { note: 'Seminar 핵심' })], {
    title: 'Diffusion intro',
    labelIds: ['paper', 'gone'],
  }),
  page('pdf:abc', '2026-10-28T05:00:00Z', [ann('attention', { anchor: { status: 'needs-review', checkedAt: 'x' } })], {
    title: 'Attention Is All You Need',
    labelIds: ['paper'],
  }),
  page('https://b.com/slack', '2026-10-28T04:00:00Z', [ann('메시지 테스트')], { title: 'Slack', labelIds: ['work'] }),
  page('https://c.com/empty', '2026-10-28T06:00:00Z', [ann('deleted', { deletedAt: 'x' })], { title: 'Only deleted' }),
];
const labels = [label('paper', 0), label('work', 1), label('gone', 2, { deletedAt: 'x' })];

describe('library filtering', () => {
  it('lists pages with live annotations, most recently edited first', () => {
    expect(filterPages(pages, '', { kind: 'all' }).map((p) => p.title)).toEqual([
      'Attention Is All You Need',
      'Slack',
      'Diffusion intro',
    ]);
  });

  it('filters by label and by the built-in chips', () => {
    expect(filterPages(pages, '', { kind: 'label', id: 'paper' }).map((p) => p.title)).toEqual([
      'Attention Is All You Need',
      'Diffusion intro',
    ]);
    expect(filterPages(pages, '', { kind: 'notes' }).map((p) => p.title)).toEqual(['Diffusion intro']);
    expect(filterPages(pages, '', { kind: 'attention' }).map((p) => p.title)).toEqual(['Attention Is All You Need']);
    expect(filterPages(pages, '', { kind: 'pdf' }).map((p) => p.title)).toEqual(['Attention Is All You Need']);
  });

  it('searches titles, URLs, quotes and notes; all terms must match; case-insensitive', () => {
    expect(pageMatchesQuery(pages[0]!, 'SEMINAR')).toBe(true);
    expect(pageMatchesQuery(pages[0]!, 'a.com reverse')).toBe(true);
    expect(pageMatchesQuery(pages[0]!, 'reverse slack')).toBe(false);
    expect(filterPages(pages, '테스트', { kind: 'all' }).map((p) => p.title)).toEqual(['Slack']);
    expect(filterPages(pages, 'deleted', { kind: 'all' })).toEqual([]);
  });

  it('counts chips after the search', () => {
    expect(countPages(pages, '', labels)).toEqual({ all: 3, notes: 1, attention: 1, pdf: 1, labels: { paper: 2, work: 1, gone: 1 } });
    expect(countPages(pages, 'attention', labels).labels.paper).toBe(1);
  });
});

describe('custom page names', () => {
  it('shows the custom name first and searches it', () => {
    const p = { ...pages[2]!, customTitle: '팀 공지 모음' };
    expect(pageDisplayTitle(p)).toBe('팀 공지 모음');
    expect(pageDisplayTitle({ ...p, customTitle: undefined })).toBe('Slack');
    expect(pageDisplayTitle({ url: 'https://x.com/a' })).toBe('https://x.com/a');
    expect(pageMatchesQuery(p, '공지')).toBe(true);
    expect(pageMatchesQuery(p, 'slack')).toBe(true); // the page's own title still matches
  });

  it('survives later annotation saves and can be cleared', async () => {
    const repo = new AnnotationRepository(new MemoryKV());
    await repo.upsert(ann('x', { pageKey: 'p', url: 'p', title: 'Page title' }));
    expect(await repo.setPageTitle('p', '  My name  ')).toBe(true);
    await repo.upsert(ann('y', { pageKey: 'p', url: 'p', title: 'Page title (updated)' }));
    const page = (await repo.getPage('p'))!;
    expect(page.customTitle).toBe('My name');
    expect(page.title).toBe('Page title (updated)');
    await repo.setPageTitle('p', '');
    expect((await repo.getPage('p'))?.customTitle).toBeUndefined();
    expect(await repo.setPageTitle('missing', 'x')).toBe(false);
  });
});

describe('labels', () => {
  it("lists a page's live labels in label order", () => {
    expect(labelsOfPage(pages[0], labels).map((l) => l.id)).toEqual(['paper']);
  });

  it('picks the least used color for a new label', () => {
    expect(nextLabelColor([])).toBe('red');
    expect(nextLabelColor([label('a', 0, { color: 'red' })])).toBe('orange');
    expect(cycleLabelColor('gray')).toBe('red');
  });

  it('moves a label up or down, clamped', () => {
    expect(moveLabel(labels, 'work', -1)).toEqual(['work', 'paper']);
    expect(moveLabel(labels, 'paper', -1)).toEqual(['paper', 'work']);
  });
});

describe('repository labels', () => {
  it('creates, reorders, deletes (tombstone) and restores labels; sets page labels', async () => {
    const repo = new AnnotationRepository(new MemoryKV());
    await repo.upsert(ann('x', { pageKey: 'p', url: 'p' }));
    await repo.upsertLabel(label('a', 0));
    await repo.upsertLabel(label('b', 1));
    await repo.reorderLabels(['b', 'a'], 'now');
    expect((await repo.listLabels()).map((l) => l.id)).toEqual(['b', 'a']);

    expect(await repo.setPageLabels('p', ['a', 'b', 'a'])).toBe(true);
    expect((await repo.getPage('p'))?.labelIds).toEqual(['a', 'b']);
    expect(await repo.setPageLabels('missing', ['a'])).toBe(false);

    await repo.removeLabel('a', 'now');
    expect((await repo.listLabels()).map((l) => l.id)).toEqual(['b']);
    expect((await repo.getPage('p'))?.labelIds).toEqual(['a', 'b']); // kept for undo
    const deleted = (await repo.listLabels(true)).find((l) => l.id === 'a')!;
    const { deletedAt: _gone, ...restored } = deleted;
    await repo.upsertLabel(restored);
    expect((await repo.listLabels()).map((l) => l.id)).toEqual(['b', 'a']);
  });
});

describe('migrations', () => {
  it('v1 → v2 updates annotation versions and keeps everything else', () => {
    const v1 = page('p', 't', [ann('x', { schemaVersion: 1 as unknown as 2 })]);
    expect(migratePageV1toV2(v1)).toEqual({ ...v1, annotations: [{ ...v1.annotations[0], schemaVersion: 2 }] });
  });

  it('migrates stored v1 data once, after a local backup', async () => {
    const kv = new MemoryKV();
    const v1 = page('p', 't', [ann('x', { schemaVersion: 1 as unknown as 2 })]);
    await kv.set({ 'wwm:meta': { schemaVersion: 1 }, 'wwm:pages': ['p'], 'wwm:page:p': v1 });
    expect(await migrateStorage(kv, 'now')).toEqual({ from: 1, to: 2, pages: 1 });
    expect(await kv.get('wwm:backup:v1')).toEqual({ createdAt: 'now', pages: [v1] });
    expect((await kv.get<PageRecord>('wwm:page:p'))?.annotations[0]?.schemaVersion).toBe(2);
    expect(await kv.get('wwm:meta')).toEqual({ schemaVersion: 2 });
    expect((await migrateStorage(kv, 'later')).pages).toBe(0);
  });

  it('a fresh install is already current', async () => {
    const kv = new MemoryKV();
    expect(await migrateStorage(kv)).toEqual({ from: 2, to: 2, pages: 0 });
    expect(await kv.get('wwm:meta')).toEqual({ schemaVersion: 2 });
  });
});
