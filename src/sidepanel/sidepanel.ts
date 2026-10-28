/**
 * Side panel: per-page annotation list (with anchor status), all-pages list,
 * JSON export. Reads via background messages; never writes storage directly.
 */
import type { HistoryAction } from '../core/history';
import { getSelector, type Annotation, type PageRecord } from '../core/types';
import { isPdfPageKey, normalizePageKey } from '../core/url';
import { localizeDocument, t, uiLanguage, type MessageKey } from '../shared/i18n';
import { sendToBackground, type Broadcast, type ContentRequest, type ContentStatus } from '../shared/messages';
import { pdfViewerUrl } from '../shared/pdf';

const SWATCH: Record<string, string> = {
  yellow: '#ffd600',
  green: '#30c478',
  blue: '#409cff',
  pink: '#ff5caa',
};
const STATUS_LABEL: Record<string, MessageKey> = {
  moved: 'badgeMoved',
  'needs-review': 'badgeNeedsReview',
  orphaned: 'badgeOrphaned',
};

const HISTORY_LABEL: Record<HistoryAction, MessageKey> = {
  create: 'historyCreate',
  delete: 'historyDelete',
  style: 'historyStyle',
  note: 'historyNote',
  confirm: 'historyConfirm',
};

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

let activeTabId: number | undefined;
let activePageKey = '';
/** False until the tab itself reported its page key (e.g. the PDF viewer is still loading). */
let keyFromTab = false;

async function refreshActiveTab(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTabId = tab?.id;
  // The tab knows its own page key (a PDF's is its fingerprint, not its URL).
  const fromTab = await tabPageKey();
  keyFromTab = fromTab !== undefined;
  activePageKey = fromTab ?? (tab?.url ? normalizePageKey(tab.url) : '');
  $('page-title').textContent = tab?.title ?? '';
  await renderPage();
}

async function renderPage(): Promise<void> {
  const list = $<HTMLUListElement>('page-list');
  const orphanList = $<HTMLUListElement>('orphan-list');
  list.replaceChildren();
  orphanList.replaceChildren();
  void renderHistory();
  if (!activePageKey) return;

  const { annotations } = await sendToBackground({ type: 'wwm/list', pageKey: activePageKey });
  const live = annotations.filter((a) => a.anchor?.status !== 'orphaned');
  const orphans = annotations.filter((a) => a.anchor?.status === 'orphaned');
  const review = annotations.filter((a) => a.anchor?.status === 'needs-review').length;

  if (live.length === 0 && orphans.length === 0) {
    list.append(empty(t('emptyPage')));
  }
  for (const a of live) list.append(item(a, true));
  for (const a of orphans) orphanList.append(item(a, false));

  $('orphans').hidden = orphans.length === 0;
  $('orphan-count').textContent = `(${orphans.length})`;

  const banner = $('banner');
  const attention = review + orphans.length;
  banner.hidden = attention === 0;
  const parts: string[] = [];
  if (review > 0) parts.push(t('bannerReview', review));
  if (orphans.length > 0) parts.push(t('bannerMissing', orphans.length));
  banner.textContent = attention === 0 ? '' : `${t('bannerUpdated')} — ${parts.join(', ')}`;
}

async function renderHistory(): Promise<void> {
  const state = activePageKey ? await sendToBackground({ type: 'wwm/history', pageKey: activePageKey }) : {};
  const set = (id: string, action: HistoryAction | undefined, withAction: MessageKey, none: MessageKey): void => {
    const b = $<HTMLButtonElement>(id);
    b.disabled = action === undefined;
    b.title = action ? t(withAction, t(HISTORY_LABEL[action])) : t(none);
    b.setAttribute('aria-label', b.title);
  };
  set('undo', state.undo, 'undoAction', 'undoNothing');
  set('redo', state.redo, 'redoAction', 'redoNothing');
}

/** Undo/redo the current page's last edit, then let the page re-render. */
async function stepHistory(type: 'wwm/undo' | 'wwm/redo'): Promise<void> {
  if (!activePageKey) return;
  const { ok } = await sendToBackground({ type, pageKey: activePageKey });
  if (ok) await sendToTab({ type: 'wwm/refresh' });
}

async function renderAll(): Promise<void> {
  const list = $<HTMLUListElement>('all-list');
  list.replaceChildren();
  const { pages } = await sendToBackground({ type: 'wwm/list-pages' });
  const nonEmpty = pages.filter((p) => p.annotations.some((a) => !a.deletedAt));
  if (nonEmpty.length === 0) list.append(empty(t('emptyAll')));
  for (const p of nonEmpty) list.append(pageItem(p));
}

function item(a: Annotation, clickable: boolean): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'item';
  li.style.setProperty('--swatch', swatchFor(a));

  const quote = document.createElement('p');
  quote.className = 'quote';
  quote.textContent = getSelector(a.target.selectors, 'TextQuoteSelector')?.exact ?? t('imagePlaceholder');
  if (a.style.bold) quote.style.fontWeight = '700';
  if (a.style.underline) quote.style.textDecoration = 'underline';
  li.append(quote);

  if (a.note) {
    const note = document.createElement('p');
    note.className = 'note';
    note.textContent = a.note;
    li.append(note);
  }

  const meta = document.createElement('div');
  meta.className = 'meta';
  const date = document.createElement('span');
  date.textContent = new Date(a.createdAt).toLocaleString(uiLanguage());
  meta.append(date);
  const status = a.anchor?.status;
  const label = status ? STATUS_LABEL[status] : undefined;
  if (status && label) {
    const badge = document.createElement('span');
    badge.className = `badge ${status}`;
    badge.textContent = t(label);
    meta.append(badge);
  }
  const spacer = document.createElement('span');
  spacer.className = 'spacer';
  const del = document.createElement('button');
  del.textContent = t('delete');
  del.addEventListener('click', async (e) => {
    e.stopPropagation();
    await sendToBackground({ type: 'wwm/delete', pageKey: a.pageKey, id: a.id });
    await sendToTab({ type: 'wwm/refresh' });
  });
  meta.append(spacer, del);
  li.append(meta);

  if (clickable) li.addEventListener('click', () => void sendToTab({ type: 'wwm/scroll-to', id: a.id }));
  return li;
}

function swatchFor(a: Annotation): string {
  if (a.style.highlight) return SWATCH[a.style.highlight] ?? '#ffd600';
  if (a.style.underline) return '#e5484d';
  if (a.style.bold) return '#6b6578';
  return '#8e4ec6'; // note only
}

function pageItem(p: PageRecord): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'item';
  const title = document.createElement('p');
  title.className = 'quote';
  title.textContent = p.title || p.url;
  const meta = document.createElement('div');
  meta.className = 'meta';
  const count = p.annotations.filter((a) => !a.deletedAt).length;
  meta.textContent = t('pageSummary', count, new Date(p.updatedAt).toLocaleDateString(uiLanguage()));
  li.append(title, meta);
  const url = isPdfPageKey(p.pageKey) ? pdfViewerUrl(p.url) : p.url;
  li.addEventListener('click', () => void chrome.tabs.create({ url }));
  return li;
}

function empty(text: string): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'empty';
  li.textContent = text;
  return li;
}

async function sendToTab(msg: ContentRequest): Promise<void> {
  if (activeTabId === undefined) return;
  try {
    await chrome.tabs.sendMessage(activeTabId, msg);
  } catch {
    // Content script not present on this tab.
  }
}

async function tabPageKey(): Promise<string | undefined> {
  if (activeTabId === undefined) return undefined;
  try {
    const status = (await chrome.tabs.sendMessage(activeTabId, { type: 'wwm/get-status' } satisfies ContentRequest)) as
      | ContentStatus
      | undefined;
    return status?.pageKey || undefined;
  } catch {
    return undefined; // No content script (chrome:// pages, Web Store) or still loading.
  }
}

async function exportJson(): Promise<void> {
  const { pages } = await sendToBackground({ type: 'wwm/export' });
  const blob = new Blob([JSON.stringify({ format: 'wwm-export', version: 1, pages }, null, 2)], {
    type: 'application/json',
  });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `wwm-export-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function setupTabs(): void {
  for (const btn of document.querySelectorAll<HTMLButtonElement>('[role="tab"]')) {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      for (const b of document.querySelectorAll<HTMLButtonElement>('[role="tab"]')) {
        b.setAttribute('aria-selected', String(b === btn));
      }
      $('tab-page').hidden = tab !== 'page';
      $('tab-all').hidden = tab !== 'all';
      if (tab === 'all') void renderAll();
    });
  }
}

document.documentElement.lang = uiLanguage();
localizeDocument();
setupTabs();
$('export').addEventListener('click', () => void exportJson());
$('undo').addEventListener('click', () => void stepHistory('wwm/undo'));
$('redo').addEventListener('click', () => void stepHistory('wwm/redo'));
// Only while the side panel has focus: on the page, ⌘Z belongs to the site's own editing.
document.addEventListener('keydown', (e) => {
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
  const key = e.key.toLowerCase();
  if (key === 'z' && !e.shiftKey) void stepHistory('wwm/undo');
  else if ((key === 'z' && e.shiftKey) || key === 'y') void stepHistory('wwm/redo');
  else return;
  e.preventDefault();
});
$('version').textContent = `v${chrome.runtime.getManifest().version}`;

chrome.tabs.onActivated.addListener(() => void refreshActiveTab());
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (tabId === activeTabId && (info.url || info.status === 'complete')) void refreshActiveTab();
});
chrome.runtime.onMessage.addListener((msg: Broadcast) => {
  if (msg.type !== 'wwm/changed') return;
  if (msg.pageKey === activePageKey) void renderPage();
  else if (!keyFromTab) void refreshActiveTab();
});

void refreshActiveTab();
