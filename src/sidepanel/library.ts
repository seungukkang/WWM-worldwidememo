/**
 * The side panel's [All] tab: one list of annotated pages (most recently
 * edited first), a search box, label chips, built-in filter chips and the
 * label manager. See docs/design/library.md.
 */
import {
  countPages,
  filterPages,
  labelsOfPage,
  liveAnnotations,
  pageDisplayTitle,
  pageMatchesFilter,
  type LibraryFilter,
} from '../core/library';
import type { Label, PageRecord } from '../core/types';
import { isPdfPageKey, normalizePageKey } from '../core/url';
import { t, uiLanguage, type MessageKey } from '../shared/i18n';
import { sendToBackground, type ContentRequest, type ContentStatus } from '../shared/messages';
import { pdfViewerUrl } from '../shared/pdf';
import { createLabel, labelDot, labelManager, labelMenu, labelTag } from './labels';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

let query = '';
let filter: LibraryFilter = { kind: 'all' };
let managing = false;
/** pageKey whose label menu is open in the list. */
let menuFor: string | null = null;
/** pageKey whose name is being edited. */
let renaming: string | null = null;
let seq = 0;

export function setupLibrary(): void {
  const search = $<HTMLInputElement>('library-search');
  search.placeholder = t('searchPlaceholder');
  search.setAttribute('aria-label', t('searchPlaceholder'));
  search.addEventListener('input', () => {
    query = search.value;
    void renderLibrary();
  });
  document.addEventListener('click', () => {
    if (menuFor === null) return;
    menuFor = null;
    void renderLibrary();
  });
}

/** Re-render the [All] tab (only the latest call writes; see renderSeq in sidepanel.ts). */
export async function renderLibrary(): Promise<void> {
  const mine = ++seq;
  const [{ pages }, { labels }] = await Promise.all([
    sendToBackground({ type: 'wwm/list-pages' }),
    sendToBackground({ type: 'wwm/labels' }),
  ]);
  if (mine !== seq) return;
  if (filter.kind === 'label' && !labels.some((l) => l.id === (filter as { id: string }).id)) filter = { kind: 'all' };

  const counts = countPages(pages, query, labels);
  renderChips(labels, counts.all, counts.labels);
  renderFilters(counts);
  const manage = $('label-manage');
  manage.hidden = !managing;
  manage.replaceChildren(...(managing ? [labelManager(labels)] : []));

  const shown = filterPages(pages, query, filter);
  const list = $<HTMLUListElement>('all-list');
  if (shown.length === 0) {
    const anyPages = pages.some((p) => liveAnnotations(p).length > 0);
    list.replaceChildren(emptyItem(t(anyPages ? 'libraryNoResults' : 'emptyAll')));
  } else {
    list.replaceChildren(...shown.map((p) => pageItem(p, labels)));
  }
}

function chip(text: string, count: number, f: LibraryFilter, className = 'chip'): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = className;
  const pressed = filter.kind === f.kind && (f.kind !== 'label' || (filter as { id?: string }).id === f.id);
  b.setAttribute('aria-pressed', String(pressed));
  const name = document.createElement('span');
  name.textContent = text;
  const n = document.createElement('span');
  n.className = 'count';
  n.textContent = String(count);
  b.append(name, n);
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    filter = pressed && f.kind !== 'all' ? { kind: 'all' } : f;
    void renderLibrary();
  });
  return b;
}

function renderChips(labels: Label[], all: number, perLabel: Record<string, number>): void {
  const row = $('library-chips');
  const chips: HTMLElement[] = [chip(t('tabAll'), all, { kind: 'all' })];
  for (const l of labels) {
    const c = chip(l.name, perLabel[l.id] ?? 0, { kind: 'label', id: l.id });
    c.prepend(labelDot(l.color));
    chips.push(c);
  }
  const add = document.createElement('button');
  add.className = 'chip add';
  add.textContent = '+';
  add.title = t('labelNew');
  add.setAttribute('aria-label', t('labelNew'));
  add.addEventListener('click', (e) => {
    e.stopPropagation();
    const input = document.createElement('input');
    input.className = 'label-input chip-input';
    input.placeholder = t('labelNewPlaceholder');
    input.maxLength = 40;
    input.addEventListener('click', (ev) => ev.stopPropagation());
    input.addEventListener('keydown', async (ev) => {
      if (ev.key === 'Enter' && input.value.trim()) await createLabel(input.value.trim(), labels);
      else if (ev.key === 'Escape') void renderLibrary();
    });
    input.addEventListener('blur', () => void renderLibrary());
    add.replaceWith(input);
    input.focus();
  });
  chips.push(add);
  row.replaceChildren(...chips);
}

function renderFilters(counts: { notes: number; attention: number; pdf: number }): void {
  const builtIn: Array<[MessageKey, number, LibraryFilter]> = [
    ['filterNotes', counts.notes, { kind: 'notes' }],
    ['filterAttention', counts.attention, { kind: 'attention' }],
    ['filterPdf', counts.pdf, { kind: 'pdf' }],
  ];
  const manage = document.createElement('button');
  manage.className = 'link';
  manage.textContent = t('labelManage');
  manage.setAttribute('aria-expanded', String(managing));
  manage.addEventListener('click', (e) => {
    e.stopPropagation();
    managing = !managing;
    void renderLibrary();
  });
  $('library-filters').replaceChildren(...builtIn.map(([key, n, f]) => chip(t(key), n, f, 'chip mini')), manage);
}

function pageItem(p: PageRecord, labels: Label[]): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'item';
  const head = document.createElement('div');
  head.className = 'item-head';
  const title = renaming === p.pageKey ? renameInput(p) : document.createElement('p');
  if (renaming !== p.pageKey) {
    title.className = 'quote';
    title.textContent = pageDisplayTitle(p);
    if (p.customTitle) title.title = p.title || p.url; // the page's own title
  }
  const rename = document.createElement('button');
  rename.className = 'icon-btn';
  rename.textContent = '✎';
  rename.title = t('renamePage');
  rename.setAttribute('aria-label', t('renamePage'));
  rename.addEventListener('click', (e) => {
    e.stopPropagation();
    renaming = renaming === p.pageKey ? null : p.pageKey;
    void renderLibrary();
  });
  const more = document.createElement('button');
  more.className = 'icon-btn more';
  more.textContent = '⋯';
  more.title = t('labelEdit');
  more.setAttribute('aria-label', t('labelEdit'));
  more.setAttribute('aria-expanded', String(menuFor === p.pageKey));
  more.addEventListener('click', (e) => {
    e.stopPropagation();
    menuFor = menuFor === p.pageKey ? null : p.pageKey;
    void renderLibrary();
  });
  head.append(title, rename, more);
  li.append(head);

  const tags = labelsOfPage(p, labels);
  if (tags.length > 0) {
    const row = document.createElement('div');
    row.className = 'tags';
    row.append(...tags.map((l) => labelTag(l)));
    li.append(row);
  }

  const meta = document.createElement('div');
  meta.className = 'meta';
  const summary = document.createElement('span');
  summary.textContent = t('pageSummary', liveAnnotations(p).length, new Date(p.updatedAt).toLocaleDateString(uiLanguage()));
  meta.append(summary);
  if (isPdfPageKey(p.pageKey)) {
    // A PDF and its web page can share a title.
    const pdf = document.createElement('span');
    pdf.className = 'badge pdf';
    pdf.textContent = t('filterPdf');
    meta.append(pdf);
  }
  if (pageMatchesFilter(p, { kind: 'attention' })) {
    const badge = document.createElement('span');
    badge.className = 'badge needs-review';
    badge.textContent = t('filterAttention');
    meta.append(badge);
  }
  li.append(meta);
  if (menuFor === p.pageKey) li.append(labelMenu(p.pageKey, labels, p.labelIds ?? []));

  li.addEventListener('click', () => void openPage(p));
  return li;
}

/** Inline name editor: Enter or leaving the field saves, Esc cancels, empty restores the page's own title. */
function renameInput(p: PageRecord): HTMLInputElement {
  const input = document.createElement('input');
  input.className = 'label-input rename';
  input.value = pageDisplayTitle(p);
  input.maxLength = 120;
  input.placeholder = t('renamePlaceholder');
  input.setAttribute('aria-label', t('renamePage'));
  let done = false;
  const finish = (save: boolean): void => {
    if (done) return;
    done = true;
    renaming = null;
    const name = input.value.trim();
    if (save && name !== pageDisplayTitle(p)) {
      void sendToBackground({ type: 'wwm/page-title', pageKey: p.pageKey, title: name === (p.title || p.url) ? '' : name });
    } else {
      void renderLibrary();
    }
  };
  input.addEventListener('click', (e) => e.stopPropagation());
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') finish(true);
    else if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
  requestAnimationFrame(() => {
    input.focus();
    input.select();
  });
  return input;
}

/** Switch to the page if it is already open in this window; otherwise open it in a new tab. */
async function openPage(p: PageRecord): Promise<void> {
  const open = await findOpenTab(p.pageKey);
  if (open?.id !== undefined) {
    await chrome.tabs.update(open.id, { active: true });
    return;
  }
  await chrome.tabs.create({ url: isPdfPageKey(p.pageKey) ? pdfViewerUrl(p.url) : p.url });
}

async function findOpenTab(pageKey: string): Promise<chrome.tabs.Tab | undefined> {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  if (!isPdfPageKey(pageKey)) {
    // Host permissions let us read http(s) tab URLs; compare them as page keys.
    return tabs.find((tab) => tab.url !== undefined && normalizePageKey(tab.url) === pageKey);
  }
  // A PDF is identified by its fingerprint, so ask WWM viewer tabs for their page key.
  const viewer = chrome.runtime.getURL('pdf/viewer.html');
  for (const tab of tabs) {
    if (tab.id === undefined || (tab.url !== undefined && !tab.url.startsWith(viewer))) continue;
    try {
      const status = (await chrome.tabs.sendMessage(tab.id, { type: 'wwm/get-status' } satisfies ContentRequest)) as
        | ContentStatus
        | undefined;
      if (status?.pageKey === pageKey) return tab;
    } catch {
      // Not a WWM page.
    }
  }
  return undefined;
}

function emptyItem(text: string): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'empty';
  li.textContent = text;
  return li;
}
