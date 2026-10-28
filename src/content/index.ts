/**
 * Content script entry: selection → toolbar → annotation; restore on visit;
 * re-anchor on DOM changes. See docs/design/architecture.md §3.
 */
import { anchorSelectors } from '../core/anchor';
import { createAnnotation } from '../core/factory';
import { describeRange } from '../core/selectors';
import { buildTextIndex, offsetsToRange, type TextIndex } from '../core/text-index';
import type { AnchorState, Annotation, AnnotationStyle } from '../core/types';
import { normalizePageKey } from '../core/url';
import { sendToBackground, type ContentRequest, type ContentStatus } from '../shared/messages';
import { HighlightRenderer, isSupported, type RenderEntry } from './renderer';
import { WwmUi } from './ui';

const MUTATION_DEBOUNCE_MS = 500;

let pageKey = normalizePageKey(location.href);
let annotations: Annotation[] = [];
let states = new Map<string, AnchorState>();
let lastReportSignature = '';
let pendingRange: Range | null = null;
let editingId: string | null = null;
let cachedIndex: TextIndex | null = null;

const renderer = new HighlightRenderer();
const ui = new WwmUi({
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
});

function textIndex(): TextIndex {
  cachedIndex ??= buildTextIndex(document.body);
  return cachedIndex;
}

// ---------------------------------------------------------------------------
// Anchoring & rendering
// ---------------------------------------------------------------------------

async function load(): Promise<void> {
  pageKey = normalizePageKey(location.href);
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
    url: location.href,
    title: document.title,
    selectors: target.selectors,
    context: target.context,
    style,
    ...(note !== undefined ? { note } : {}),
  });
  const { annotation } = await sendToBackground({ type: 'wwm/upsert', annotation: draft });
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
    await persist(updated);
  } else {
    await createFromPending({}, text);
  }
  ui.hideAll();
}

async function remove(id: string): Promise<void> {
  await sendToBackground({ type: 'wwm/delete', pageKey, id });
  annotations = annotations.filter((a) => a.id !== id);
  ui.hideAll();
  anchorAll();
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
  });
  ui.hideAll();
}

async function persist(a: Annotation): Promise<void> {
  const { annotation } = await sendToBackground({ type: 'wwm/upsert', annotation: a });
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
  if (!document.body.contains(range.commonAncestorContainer)) return null;
  if (range.toString().trim().length === 0) return null;
  return range.cloneRange();
}

function onSelectionEnd(): void {
  setTimeout(() => {
    const range = currentSelectionRange();
    if (!range) return;
    pendingRange = range;
    ui.showToolbar(range.getBoundingClientRect());
  }, 0);
}

document.addEventListener('mouseup', (e) => {
  if (ui.contains(e.target)) return;
  onSelectionEnd();
});

document.addEventListener('keyup', (e) => {
  if (e.shiftKey && !ui.contains(e.target)) onSelectionEnd();
});

document.addEventListener('mousedown', (e) => {
  if (!ui.contains(e.target) && ui.isOpen()) ui.hideAll();
});

document.addEventListener('click', (e) => {
  if (ui.contains(e.target) || currentSelectionRange()) return;
  const id = renderer.hitTest(e.clientX, e.clientY);
  const a = id ? renderer.get(id)?.annotation : undefined;
  if (a) ui.showPopover(new DOMRect(e.clientX, e.clientY, 0, 0), a);
});

chrome.runtime.onMessage.addListener((msg: ContentRequest, _sender, sendResponse) => {
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
      if (!range) return;
      pendingRange = range;
      if (msg.command === 'note') ui.showEditor(range.getBoundingClientRect());
      else if (msg.command === 'underline') void createFromPending({ underline: true });
      else void createFromPending({ highlight: 'yellow' });
      break;
    }
  }
  sendResponse({ ok: true });
});

// DOM changes: SPA navigation, lazy content, re-renders that detach our Ranges.
let mutationTimer: ReturnType<typeof setTimeout> | undefined;
const observer = new MutationObserver(() => {
  clearTimeout(mutationTimer);
  mutationTimer = setTimeout(() => {
    cachedIndex = null;
    if (normalizePageKey(location.href) !== pageKey) {
      lastReportSignature = '';
      void load();
      return;
    }
    const broken = renderer.all().some((e) => !e.range.startContainer.isConnected || e.range.collapsed);
    const missing = [...states.values()].some((s) => s.status === 'orphaned');
    if (broken || missing) anchorAll();
  }, MUTATION_DEBOUNCE_MS);
});

function start(): void {
  if (!isSupported()) {
    console.warn('[WWM] CSS Custom Highlight API not available; rendering disabled.');
  }
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  void load().catch((err: unknown) => console.warn('[WWM] load failed', err));
}

if (document.body) start();
else document.addEventListener('DOMContentLoaded', start, { once: true });
