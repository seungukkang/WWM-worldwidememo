/**
 * Side panel: per-page annotation list (with anchor status), all-pages list,
 * JSON export. Reads via background messages; never writes storage directly.
 */
import type { HistoryAction } from '../core/history';
import { DEFAULT_SETTINGS, siteOf, type Settings, type ToolbarMode, type ToolbarPlacement } from '../core/settings';
import { getSelector, type Annotation, type HighlightColor, type Label } from '../core/types';
import { normalizePageKey } from '../core/url';
import { localizeDocument, t, uiLanguage, type MessageKey } from '../shared/i18n';
import { sendToBackground, type Broadcast, type ContentRequest, type ContentStatus } from '../shared/messages';
import { loadSettings, onSettingsChanged } from '../shared/settings';
import { labelMenu, labelTag, setPageLabels } from './labels';
import { renderLibrary, setupLibrary } from './library';

const SWATCH: Record<string, string> = {
  yellow: '#ffd600',
  green: '#30c478',
  blue: '#409cff',
  pink: '#ff5caa',
};
const COLOR_LABEL: Record<HighlightColor, MessageKey> = {
  yellow: 'colorYellow',
  green: 'colorGreen',
  blue: 'colorBlue',
  pink: 'colorPink',
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
/** The tab's own title; the page tab shows the user's name for the page instead, if any. */
let activeTabTitle = '';
/** Site (hostname) of the active tab, for "turn off on this site"; null for non-web pages. */
let activeSite: string | null = null;
let currentSettings: Settings = DEFAULT_SETTINGS;
/** False until the tab itself reported its page key (e.g. the PDF viewer is still loading). */
let keyFromTab = false;

async function refreshActiveTab(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTabId = tab?.id;
  // The tab knows its own page key (a PDF's is its fingerprint, not its URL).
  const fromTab = await tabPageKey();
  keyFromTab = fromTab !== undefined;
  activePageKey = fromTab ?? (tab?.url ? normalizePageKey(tab.url) : '');
  activeTabTitle = tab?.title ?? '';
  $('page-title').textContent = activeTabTitle;
  activeSite = siteOfTab(tab?.url);
  renderSwitch();
  await renderPage();
}

/**
 * Renders can overlap (one edit broadcasts several changes). Each render
 * fetches first and replaces the DOM in one step, and only the latest render
 * of each kind may write — otherwise overlapping renders append twice.
 */
const renderSeq = { page: 0, history: 0 };
/** The [This page] label menu is open. */
let pageLabelMenuOpen = false;

async function renderPage(): Promise<void> {
  const seq = ++renderSeq.page;
  void renderHistory();
  const [{ annotations, labelIds, customTitle }, { labels }] = await Promise.all([
    activePageKey
      ? sendToBackground({ type: 'wwm/list', pageKey: activePageKey })
      : Promise.resolve({ annotations: [], labelIds: [], customTitle: undefined }),
    sendToBackground({ type: 'wwm/labels' }),
  ]);
  if (seq !== renderSeq.page) return;
  $('page-title').textContent = customTitle || activeTabTitle;
  renderPageLabels(annotations.length > 0, labelIds, labels);

  const live = annotations.filter((a) => a.anchor?.status !== 'orphaned');
  const orphans = annotations.filter((a) => a.anchor?.status === 'orphaned');
  const review = annotations.filter((a) => a.anchor?.status === 'needs-review').length;

  const items = live.map((a) => item(a, true));
  if (activePageKey && items.length === 0 && orphans.length === 0) items.push(empty(t('emptyPage')));
  $<HTMLUListElement>('page-list').replaceChildren(...items);
  $<HTMLUListElement>('orphan-list').replaceChildren(...orphans.map((a) => item(a, false)));

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
  const seq = ++renderSeq.history;
  const state = activePageKey ? await sendToBackground({ type: 'wwm/history', pageKey: activePageKey }) : {};
  if (seq !== renderSeq.history) return;
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

/** Labels of the current page (only once it has annotations): tags with ×, "+ Label" menu. */
function renderPageLabels(hasAnnotations: boolean, labelIds: string[], labels: Label[]): void {
  const row = $('page-labels');
  row.hidden = !hasAnnotations;
  if (!hasAnnotations) {
    pageLabelMenuOpen = false;
    return;
  }
  // `labels` are the live labels in order, so this keeps label order.
  const tags = labels.filter((l) => labelIds.includes(l.id)).map((l) =>
    labelTag(l, () => void setPageLabels(activePageKey, labelIds.filter((id) => id !== l.id))),
  );
  const add = document.createElement('button');
  add.className = 'chip add';
  add.textContent = t('labelAdd');
  add.setAttribute('aria-expanded', String(pageLabelMenuOpen));
  add.addEventListener('click', (e) => {
    e.stopPropagation();
    pageLabelMenuOpen = !pageLabelMenuOpen;
    void renderPage();
  });
  row.replaceChildren(...tags, add, ...(pageLabelMenuOpen ? [labelMenu(activePageKey, labels, labelIds)] : []));
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

/**
 * Style bar: annotate the text selected on the page (the page keeps its
 * selection while the side panel is clicked). Works in every toolbar mode and
 * is the main tool in "side panel only" mode.
 */
function setupStyleBar(): void {
  const bar = $('stylebar');
  const hint = document.createElement('span');
  hint.className = 'hint';
  hint.hidden = true;
  let hintTimer: ReturnType<typeof setTimeout> | undefined;
  const run = async (msg: ContentRequest): Promise<void> => {
    if ((await sendToTabForResult(msg))?.ok) return;
    hint.textContent = t('panelSelectFirst');
    hint.hidden = false;
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => (hint.hidden = true), 3000);
  };
  const button = (label: string, title: string, msg: ContentRequest): HTMLButtonElement => {
    const b = document.createElement('button');
    b.textContent = label;
    b.title = title;
    b.setAttribute('aria-label', title);
    b.addEventListener('click', () => void run(msg));
    return b;
  };
  const sep = (): HTMLSpanElement => Object.assign(document.createElement('span'), { className: 'sep' });

  for (const [color, label] of Object.entries(COLOR_LABEL)) {
    const b = button('', t('toolbarHighlight', t(label)), { type: 'wwm/apply-style', style: { highlight: color as HighlightColor } });
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = SWATCH[color] ?? '';
    b.append(dot);
    bar.append(b);
  }
  const u = button('U', t('toolbarUnderline'), { type: 'wwm/apply-style', style: { underline: true } });
  u.classList.add('u');
  bar.append(
    sep(),
    u,
    button('B', t('toolbarBold'), { type: 'wwm/apply-style', style: { bold: true } }),
    sep(),
    button(t('toolbarNote'), t('toolbarNoteTitle'), { type: 'wwm/command', command: 'note' }),
    hint,
  );
}

/** Toolbar settings, shown under the header when the ⚙ button is pressed. */
function setupSettings(): void {
  const panel = $('settings');
  const toggle = $<HTMLButtonElement>('settings-toggle');
  toggle.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    toggle.setAttribute('aria-expanded', String(!panel.hidden));
  });

  const mode = $<HTMLSelectElement>('set-mode');
  const placement = $<HTMLSelectElement>('set-placement');
  const opacity = $<HTMLInputElement>('set-opacity');
  const opacityValue = $<HTMLOutputElement>('set-opacity-value');
  const show = (s: Settings): void => {
    currentSettings = s;
    renderSwitch();
    mode.value = s.toolbarMode;
    placement.value = s.toolbarPlacement;
    opacity.value = String(Math.round(s.toolbarOpacity * 100));
    opacityValue.value = `${opacity.value}%`;
    // Position and opacity only matter when something is shown on the page.
    for (const el of [placement, opacity]) el.disabled = s.toolbarMode === 'panel';
  };
  const save = (patch: Partial<Settings>): void => void sendToBackground({ type: 'wwm/settings-set', patch });

  mode.addEventListener('change', () => save({ toolbarMode: mode.value as ToolbarMode }));
  placement.addEventListener('change', () => save({ toolbarPlacement: placement.value as ToolbarPlacement }));
  opacity.addEventListener('input', () => (opacityValue.value = `${opacity.value}%`));
  opacity.addEventListener('change', () => save({ toolbarOpacity: Number(opacity.value) / 100 }));

  void loadSettings().then(show);
  onSettingsChanged(show);
}

/** A tab's site; for the WWM PDF viewer, the site the PDF comes from. */
function siteOfTab(url: string | undefined): string | null {
  if (!url) return null;
  const viewer = chrome.runtime.getURL('pdf/viewer.html');
  if (url.startsWith(viewer)) return siteOf(new URL(url).searchParams.get('file') ?? '');
  return siteOf(url);
}

function saveSettings(patch: Partial<Settings>): void {
  void sendToBackground({ type: 'wwm/settings-set', patch });
}

/** The on/off switch, the "off" notice, the per-site checkbox and the style bar's state. */
function renderSwitch(): void {
  const { enabled, disabledSites } = currentSettings;
  const siteOff = activeSite !== null && disabledSites.includes(activeSite);
  const sw = $<HTMLButtonElement>('wwm-switch');
  sw.setAttribute('aria-checked', String(enabled));
  sw.title = t(enabled ? 'switchOnTitle' : 'switchOffTitle');
  sw.setAttribute('aria-label', sw.title);

  const notice = $('off-notice');
  notice.hidden = enabled && !siteOff;
  notice.textContent = !enabled ? t('offNotice') : siteOff && activeSite ? t('siteOffNotice', activeSite) : '';

  $('site-settings').hidden = activeSite === null;
  if (activeSite) {
    $<HTMLInputElement>('set-site-off').checked = siteOff;
    $('site-off-label').textContent = t('siteDisable', activeSite);
  }
  const off = !enabled || siteOff;
  $('stylebar').classList.toggle('disabled', off);
  for (const b of $('stylebar').querySelectorAll('button')) b.disabled = off;
}

function setupSwitch(): void {
  $('wwm-switch').addEventListener('click', () => saveSettings({ enabled: !currentSettings.enabled }));
  const siteOff = $<HTMLInputElement>('set-site-off');
  siteOff.addEventListener('change', () => {
    if (!activeSite) return;
    const others = currentSettings.disabledSites.filter((s) => s !== activeSite);
    saveSettings({ disabledSites: siteOff.checked ? [...others, activeSite] : others });
  });
}

async function sendToTabForResult(msg: ContentRequest): Promise<{ ok?: boolean } | undefined> {
  if (activeTabId === undefined) return undefined;
  try {
    return (await chrome.tabs.sendMessage(activeTabId, msg)) as { ok?: boolean } | undefined;
  } catch {
    return undefined; // No content script on this tab.
  }
}

async function exportJson(): Promise<void> {
  const { pages, labels } = await sendToBackground({ type: 'wwm/export' });
  const blob = new Blob([JSON.stringify({ format: 'wwm-export', version: 2, pages, labels }, null, 2)], {
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
      if (tab === 'all') void renderLibrary();
    });
  }
}

document.documentElement.lang = uiLanguage();
localizeDocument();
setupTabs();
$('export').addEventListener('click', () => void exportJson());
setupStyleBar();
setupSwitch();
setupLibrary();
document.addEventListener('click', () => {
  if (!pageLabelMenuOpen) return;
  pageLabelMenuOpen = false;
  void renderPage();
});
setupSettings();
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
  const libraryShown = !$('tab-all').hidden;
  if (msg.type === 'wwm/labels-changed') {
    void renderPage();
    if (libraryShown) void renderLibrary();
    return;
  }
  if (msg.type !== 'wwm/changed') return;
  if (libraryShown) void renderLibrary();
  if (msg.pageKey === activePageKey) void renderPage();
  else if (!keyFromTab) void refreshActiveTab();
});

void refreshActiveTab();
