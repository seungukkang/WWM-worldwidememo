/**
 * Annotator: selection → toolbar → annotation; restore on visit; re-anchor on
 * DOM changes. Shared by the content script (web pages) and the PDF viewer
 * (pdf.js text layer). See docs/design/architecture.md §3.
 */
import { anchorSelectors } from '../core/anchor';
import { createAnnotation } from '../core/factory';
import { describeRange } from '../core/selectors';
import { buildTextIndex, offsetsToRange, type TextIndex } from '../core/text-index';
import type { HistoryAction } from '../core/history';
import { DEFAULT_SETTINGS, type Settings } from '../core/settings';
import { hasVisibleStyle, toggleStyle, type StyleChange } from '../core/style';
import type { AnchorState, Annotation, AnnotationStyle } from '../core/types';
import { t } from '../shared/i18n';
import { sendToBackground, type ContentRequest, type ContentStatus } from '../shared/messages';
import { loadSettings, onSettingsChanged } from '../shared/settings';
import { HighlightRenderer, isSupported, type RenderEntry } from './renderer';
import { WwmUi, type UiHandlers } from './ui';

const MUTATION_DEBOUNCE_MS = 500;

/** Where the annotatable text lives and how the page is identified. */
export interface AnnotatorHost {
  root(): HTMLElement;
  pageKey(): string;
  url(): string;
  title(): string;
}

let host: AnnotatorHost;
let pageKey = '';
let annotations: Annotation[] = [];
let states = new Map<string, AnchorState>();
let lastReportSignature = '';
let pendingRange: Range | null = null;
let editingId: string | null = null;
let cachedIndex: TextIndex | null = null;
let settings: Settings = DEFAULT_SETTINGS;

// Created in startAnnotator() so importing this module has no side effects.
let renderer: HighlightRenderer;
let ui: WwmUi;

const uiHandlers: UiHandlers = {
  onApplyStyle: (style) => void createFromPending(style),
  onRequestNote: () => {
    if (!pendingRange) return;
    editingId = null;
    ui.showEditor(pendingRange.getBoundingClientRect());
  },
  onSaveNote: (text) => void saveNote(text),
  onEdit: (id) => {
    const e = renderer.get(id);
    if (!e) return;
    editingId = id;
    ui.showEditor(e.range.getBoundingClientRect(), e.annotation.note ?? '');
  },
  onDelete: (id) => void remove(id),
  onConfirm: (id) => void confirmPosition(id),
  onChangeStyle: (id, change) => void changeStyle(id, change),
};

function textIndex(): TextIndex {
  cachedIndex ??= buildTextIndex(host.root());
  return cachedIndex;
}

// ---------------------------------------------------------------------------
// Anchoring & rendering
// ---------------------------------------------------------------------------

async function load(): Promise<void> {
  pageKey = host.pageKey();
  const res = await sendToBackground({ type: 'wwm/list', pageKey });
  annotations = res.annotations;
  anchorAll();
}

function anchorAll(): void {
  cachedIndex = null;
  const index = textIndex();
  const entries: RenderEntry[] = [];
  const now = new Date().toISOString();
  states = new Map();

  for (const a of annotations) {
    const m = anchorSelectors(index.text, a.target.selectors);
    const range = m ? offsetsToRange(index, m.start, m.end) : null;
    if (m && range) {
      // A user-confirmed anchor stays "anchored" as long as T0/T1 still find it.
      const status = a.anchor?.method === 'manual' && m.status === 'anchored' ? 'anchored' : m.status;
      states.set(a.id, { status, method: m.method, confidence: round(m.confidence), checkedAt: now });
      entries.push({ annotation: { ...a, anchor: states.get(a.id)! }, range });
    } else {
      states.set(a.id, { status: 'orphaned', checkedAt: now });
    }
  }
  renderer.render(entries);
  void report();
}

async function report(): Promise<void> {
  if (annotations.length === 0) return;
  const results = [...states].map(([id, anchor]) => ({ id, anchor }));
  const signature = results.map((r) => `${r.id}:${r.anchor.status}`).join('|');
  if (signature === lastReportSignature) return;
  lastReportSignature = signature;
  await sendToBackground({ type: 'wwm/anchor-report', pageKey, results });
}

const round = (x: number): number => Math.round(x * 1000) / 1000;

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

async function createFromPending(style: AnnotationStyle, note?: string): Promise<void> {
  const range = pendingRange;
  if (!range) return;
  cachedIndex = null;
  const target = describeRange(textIndex(), range);
  if (!target) return;
  const draft = createAnnotation({
    pageKey,
    url: host.url(),
    title: host.title(),
    selectors: target.selectors,
    context: target.context,
    style,
    ...(note !== undefined ? { note } : {}),
  });
  const { annotation } = await sendToBackground({ type: 'wwm/upsert', annotation: draft, action: 'create' });
  annotations.push(annotation);
  window.getSelection()?.removeAllRanges();
  pendingRange = null;
  ui.hideAll();
  anchorAll();
}

async function saveNote(text: string): Promise<void> {
  if (editingId) {
    const a = annotations.find((x) => x.id === editingId);
    editingId = null;
    if (!a) return;
    const updated: Annotation = { ...a };
    if (text.trim()) updated.note = text;
    else delete updated.note;
    // Clearing the note of a note-only annotation would leave nothing visible.
    if (!updated.note && !hasVisibleStyle(updated.style)) {
      await remove(a.id);
      return;
    }
    await persist(updated, 'note');
  } else if (text.trim()) {
    await createFromPending({}, text);
  }
  ui.hideAll();
}

async function changeStyle(id: string, change: StyleChange): Promise<void> {
  const a = annotations.find((x) => x.id === id);
  const style = a && toggleStyle(a.style, change, Boolean(a.note));
  if (!a || !style) return;
  await persist({ ...a, style }, 'style');
  const updated = annotations.find((x) => x.id === id);
  if (updated) ui.refreshPopover({ ...updated, anchor: states.get(id) ?? updated.anchor });
}

async function remove(id: string): Promise<void> {
  const removed = annotations.find((a) => a.id === id);
  await sendToBackground({ type: 'wwm/delete', pageKey, id });
  annotations = annotations.filter((a) => a.id !== id);
  ui.hideAll();
  anchorAll();
  if (removed) ui.showToast(t('deletedToast'), { label: t('undo'), run: () => void undoDelete(id) });
}

/** The toast's Undo goes through the page history, so the side panel's undo/redo stays consistent. */
async function undoDelete(id: string): Promise<void> {
  const { ok } = await sendToBackground({ type: 'wwm/undo', pageKey, expectId: id });
  if (ok) await load();
}

/** User confirms a needs-review anchor: the current location becomes canonical. */
async function confirmPosition(id: string): Promise<void> {
  const e = renderer.get(id);
  const a = annotations.find((x) => x.id === id);
  if (!e || !a) return;
  const target = describeRange(textIndex(), e.range);
  if (!target) return;
  await persist({
    ...a,
    target: { selectors: target.selectors, context: target.context },
    anchor: { status: 'anchored', method: 'manual', confidence: 1, checkedAt: new Date().toISOString() },
  }, 'confirm');
  ui.hideAll();
}

async function persist(a: Annotation, action: HistoryAction): Promise<void> {
  const { annotation } = await sendToBackground({ type: 'wwm/upsert', annotation: a, action });
  annotations = annotations.map((x) => (x.id === annotation.id ? annotation : x));
  anchorAll();
}

function scrollTo(id: string): void {
  const e = renderer.get(id);
  if (!e) return;
  const rect = e.range.getBoundingClientRect();
  window.scrollBy({ top: rect.top - window.innerHeight / 3, behavior: 'smooth' });
  renderer.flash(id);
}

function counts(): ContentStatus['counts'] {
  const c: ContentStatus['counts'] = { anchored: 0, moved: 0, 'needs-review': 0, orphaned: 0 };
  for (const s of states.values()) c[s.status]++;
  return c;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

function currentSelectionRange(): Range | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!host.root().contains(range.commonAncestorContainer)) return null;
  if (range.toString().trim().length === 0) return null;
  return range.cloneRange();
}

function onSelectionEnd(): void {
  setTimeout(() => {
    const range = currentSelectionRange();
    if (!range) return;
    pendingRange = range;
    presentSelection(range);
  }, 0);
}

/** Show the toolbar, the compact icon, or nothing for a selection, per the current settings. */
function presentSelection(range: Range): void {
  const rect = range.getBoundingClientRect();
  if (settings.toolbarMode === 'full') ui.showToolbar(rect);
  else if (settings.toolbarMode === 'compact') {
    const lines = range.getClientRects();
    ui.showLauncher(rect, lines[lines.length - 1] ?? rect);
  } else {
    // 'panel': nothing on the page; the side panel's style bar, shortcuts and
    // the context menu act on the selection.
    ui.hideAll();
  }
}

// DOM changes: SPA navigation, lazy content, re-renders that detach our Ranges.
let mutationTimer: ReturnType<typeof setTimeout> | undefined;
const observer = new MutationObserver(() => {
  clearTimeout(mutationTimer);
  mutationTimer = setTimeout(() => {
    cachedIndex = null;
    if (host.pageKey() !== pageKey) {
      lastReportSignature = '';
      void load();
      return;
    }
    const broken = renderer.all().some((e) => !e.range.startContainer.isConnected || e.range.collapsed);
    const missing = [...states.values()].some((s) => s.status === 'orphaned');
    if (broken || missing) anchorAll();
  }, MUTATION_DEBOUNCE_MS);
});

function onMouseUp(e: MouseEvent): void {
  if (ui.contains(e.target)) return;
  onSelectionEnd();
}

function onKeyUp(e: KeyboardEvent): void {
  if (e.shiftKey && !ui.contains(e.target)) onSelectionEnd();
}

/** Esc closes WWM's own toolbar/popover only; the page still receives the key. */
function onKeyDown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && ui.isOpen()) ui.hideAll();
}

function onMouseDown(e: MouseEvent): void {
  if (!ui.contains(e.target) && ui.isOpen()) ui.hideAll();
}

function onClick(e: MouseEvent): void {
  if (ui.contains(e.target) || currentSelectionRange()) return;
  const id = renderer.hitTest(e.clientX, e.clientY);
  const a = id ? renderer.get(id)?.annotation : undefined;
  if (a) ui.showPopover(new DOMRect(e.clientX, e.clientY, 0, 0), a);
}

const CONTENT_REQUESTS = new Set<string>(['wwm/scroll-to', 'wwm/refresh', 'wwm/command', 'wwm/apply-style', 'wwm/get-status']);

function onMessage(msg: ContentRequest, _sender: chrome.runtime.MessageSender, sendResponse: (r: unknown) => void): void {
  // Extension pages (the PDF viewer) also receive runtime messages meant for the
  // background; answering those would race the background's response.
  if (!CONTENT_REQUESTS.has(msg.type)) return;
  switch (msg.type) {
    case 'wwm/scroll-to':
      scrollTo(msg.id);
      break;
    case 'wwm/refresh':
      void load();
      break;
    case 'wwm/get-status':
      sendResponse({ pageKey, counts: counts() } satisfies ContentStatus);
      return;
    case 'wwm/command': {
      const range = currentSelectionRange();
      if (!range) {
        sendResponse({ ok: false });
        return;
      }
      pendingRange = range;
      if (msg.command === 'note') ui.showEditor(range.getBoundingClientRect());
      else if (msg.command === 'underline') void createFromPending({ underline: true });
      else void createFromPending({ highlight: 'yellow' });
      break;
    }
    case 'wwm/apply-style': {
      const range = currentSelectionRange();
      if (!range) {
        sendResponse({ ok: false });
        return;
      }
      pendingRange = range;
      void createFromPending(msg.style);
      break;
    }
  }
  sendResponse({ ok: true });
}

export function startAnnotator(h: AnnotatorHost): void {
  host = h;
  renderer = new HighlightRenderer();
  ui = new WwmUi(uiHandlers);
  const apply = (s: Settings): void => {
    // A selection already on screen (toolbar/icon showing, or nothing shown in
    // "side panel only" mode) is re-presented with the new settings right away.
    const reshow = !ui.isEditing() && (ui.isSelectionUiOpen() || settings.toolbarMode === 'panel');
    settings = s;
    ui.applySettings(s);
    const range = reshow ? currentSelectionRange() : null;
    if (range) {
      pendingRange = range;
      presentSelection(range);
    }
  };
  void loadSettings().then(apply, () => undefined);
  onSettingsChanged(apply);
  if (!isSupported()) {
    console.warn('[WWM] CSS Custom Highlight API not available; rendering disabled.');
  }
  document.addEventListener('mouseup', onMouseUp);
  document.addEventListener('keyup', onKeyUp);
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('mousedown', onMouseDown);
  document.addEventListener('click', onClick);
  chrome.runtime.onMessage.addListener(onMessage);
  observer.observe(host.root(), { childList: true, subtree: true, characterData: true });
  void load().catch((err: unknown) => console.warn('[WWM] load failed', err));
}
