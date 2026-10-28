/**
 * Background service worker: single writer for storage, message router,
 * badge updates, context menu and keyboard-command relay.
 *
 * MV3 service workers are terminated when idle — keep no state in memory
 * that cannot be rebuilt from storage.
 */
import {
  HistoryStore,
  recordEdit,
  redoState,
  takeRedo,
  takeUndo,
  undoState,
  type HistoryEntry,
  type PageHistory,
} from '../core/history';
import { migrateStorage } from '../core/migrations';
import { AnnotationRepository, type KVStore } from '../core/repository';
import { normalizeSettings, SETTINGS_KEY } from '../core/settings';
import type { AnchorState, Annotation } from '../core/types';
import { isPdfPageKey, normalizePageKey } from '../core/url';
import { t } from '../shared/i18n';
import type { BackgroundRequest, Broadcast, ContentRequest } from '../shared/messages';
import { pdfViewerUrl } from '../shared/pdf';

class ChromeStorageKV implements KVStore {
  constructor(private readonly area: chrome.storage.StorageArea) {}
  async get<T>(key: string): Promise<T | undefined> {
    const res = await this.area.get(key);
    return res[key] as T | undefined;
  }
  async set(entries: Record<string, unknown>): Promise<void> {
    await this.area.set(entries);
  }
  async remove(keys: string[]): Promise<void> {
    await this.area.remove(keys);
  }
}

const local = new ChromeStorageKV(chrome.storage.local);
const repo = new AnnotationRepository(local);
// Bring stored data to the current schema before handling any request.
const ready = migrateStorage(local).catch((err: unknown) => console.warn('[WWM] migration failed', err));
// Undo history lives for the browser session (survives reloads and service
// worker restarts, cleared when the browser closes).
const history = new HistoryStore(new ChromeStorageKV(chrome.storage.session));

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  chrome.contextMenus.create({
    id: 'wwm-highlight',
    title: t('menuHighlight'),
    contexts: ['selection'],
  });
  chrome.contextMenus.create({
    id: 'wwm-note',
    title: t('menuNote'),
    contexts: ['selection'],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id) return;
  const command = info.menuItemId === 'wwm-note' ? 'note' : 'highlight';
  void sendToTab(tab.id, { type: 'wwm/command', command });
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (!tab?.id) return;
  void sendToTab(tab.id, { type: 'wwm/command', command });
});

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((msg: BackgroundRequest, sender, sendResponse) => {
  ready
    .then(() => handle(msg, sender))
    .then(sendResponse)
    .catch((err: unknown) => sendResponse({ error: err instanceof Error ? err.message : String(err) }));
  return true; // async response
});

async function handle(msg: BackgroundRequest, sender: chrome.runtime.MessageSender): Promise<unknown> {
  switch (msg.type) {
    case 'wwm/list': {
      const page = await repo.getPage(msg.pageKey);
      return {
        annotations: await repo.list(msg.pageKey),
        labelIds: page?.labelIds ?? [],
        ...(page?.customTitle ? { customTitle: page.customTitle } : {}),
      };
    }

    case 'wwm/list-pages':
      return { pages: await repo.listPages() };

    case 'wwm/upsert': {
      const before = await findAnnotation(msg.annotation.pageKey, msg.annotation.id);
      const annotation = await repo.upsert({ ...msg.annotation, updatedAt: new Date().toISOString() });
      await record({ action: msg.action, before: before?.deletedAt ? null : (before ?? null), after: annotation });
      broadcast({ type: 'wwm/changed', pageKey: annotation.pageKey });
      return { annotation };
    }

    case 'wwm/delete': {
      const before = await findAnnotation(msg.pageKey, msg.id);
      const ok = await repo.remove(msg.pageKey, msg.id);
      const after = await findAnnotation(msg.pageKey, msg.id);
      if (ok && before && after) await record({ action: 'delete', before, after });
      broadcast({ type: 'wwm/changed', pageKey: msg.pageKey });
      return { ok };
    }

    case 'wwm/undo':
    case 'wwm/redo': {
      const undo = msg.type === 'wwm/undo';
      const expectId = msg.type === 'wwm/undo' ? msg.expectId : undefined;
      const entry = await history.update(msg.pageKey, (h) => {
        const next = expectId && h.undo.at(-1)?.after.id !== expectId ? null : undo ? takeUndo(h) : takeRedo(h);
        return next ? { history: next.history, result: next.entry } : { history: h, result: null };
      });
      if (!entry) return { ok: false };
      const now = new Date().toISOString();
      await repo.upsert(undo ? undoState(entry, now) : redoState(entry, now));
      broadcast({ type: 'wwm/changed', pageKey: msg.pageKey });
      return { ok: true };
    }

    case 'wwm/settings-set': {
      const stored = await chrome.storage.sync.get(SETTINGS_KEY);
      const settings = normalizeSettings({ ...normalizeSettings(stored[SETTINGS_KEY]), ...msg.patch });
      await chrome.storage.sync.set({ [SETTINGS_KEY]: settings });
      return { settings };
    }

    case 'wwm/history': {
      const h = await history.get(msg.pageKey);
      return { undo: h.undo.at(-1)?.action, redo: h.redo.at(-1)?.action };
    }

    case 'wwm/anchor-report': {
      await applyAnchorReport(msg.pageKey, msg.results);
      if (sender.tab?.id !== undefined) await updateBadge(sender.tab.id, msg.results.map((r) => r.anchor));
      broadcast({ type: 'wwm/changed', pageKey: msg.pageKey });
      return { ok: true };
    }

    case 'wwm/export':
      return { pages: await repo.exportAll(), labels: await repo.listLabels(true) };

    case 'wwm/labels':
      return { labels: await repo.listLabels() };

    case 'wwm/label-save': {
      const label = await repo.upsertLabel({ ...msg.label, updatedAt: new Date().toISOString() });
      broadcast({ type: 'wwm/labels-changed' });
      return { label };
    }

    case 'wwm/label-delete': {
      const ok = await repo.removeLabel(msg.id, new Date().toISOString());
      broadcast({ type: 'wwm/labels-changed' });
      return { ok };
    }

    case 'wwm/labels-reorder':
      await repo.reorderLabels(msg.ids, new Date().toISOString());
      broadcast({ type: 'wwm/labels-changed' });
      return { ok: true };

    case 'wwm/tab-state': {
      const tabId = sender.tab?.id;
      if (tabId !== undefined) {
        await chrome.action.setBadgeText({ tabId, text: msg.active ? '' : 'OFF' });
        if (!msg.active) await chrome.action.setBadgeBackgroundColor({ tabId, color: '#8B8D98' });
      }
      return { ok: true };
    }

    case 'wwm/page-title': {
      const ok = await repo.setPageTitle(msg.pageKey, msg.title);
      broadcast({ type: 'wwm/changed', pageKey: msg.pageKey });
      return { ok };
    }

    case 'wwm/page-labels': {
      const ok = await repo.setPageLabels(msg.pageKey, msg.labelIds);
      broadcast({ type: 'wwm/changed', pageKey: msg.pageKey });
      return { ok };
    }

    case 'wwm/pdf-lookup': {
      const key = normalizePageKey(msg.url);
      const pages = await repo.listPages();
      const known = pages.some(
        (p) => isPdfPageKey(p.pageKey) && normalizePageKey(p.url) === key && p.annotations.some((a) => !a.deletedAt),
      );
      return { known };
    }

    case 'wwm/open-pdf': {
      const tabId = sender.tab?.id;
      if (tabId === undefined || !/^https?:/i.test(msg.url)) return { ok: false };
      await chrome.tabs.update(tabId, { url: pdfViewerUrl(msg.url) });
      return { ok: true };
    }
  }
}

async function findAnnotation(pageKey: string, id: string): Promise<Annotation | undefined> {
  return (await repo.getPage(pageKey))?.annotations.find((a) => a.id === id);
}

function record(entry: HistoryEntry): Promise<void> {
  return history.update(entry.after.pageKey, (h: PageHistory) => ({ history: recordEdit(h, entry), result: undefined }));
}

/** Persist anchor status changes only (avoid rewriting storage on every visit). */
async function applyAnchorReport(pageKey: string, results: Array<{ id: string; anchor: AnchorState }>): Promise<void> {
  const current = await repo.list(pageKey);
  const byId = new Map(current.map((a) => [a.id, a]));
  for (const { id, anchor } of results) {
    const a = byId.get(id);
    if (!a) continue;
    if (a.anchor?.status === anchor.status && a.anchor?.method === anchor.method) continue;
    await repo.upsert({ ...a, anchor });
  }
}

async function updateBadge(tabId: number, states: AnchorState[]): Promise<void> {
  const attention = states.filter((s) => s.status === 'needs-review' || s.status === 'orphaned').length;
  await chrome.action.setBadgeText({ tabId, text: attention > 0 ? String(attention) : '' });
  if (attention > 0) await chrome.action.setBadgeBackgroundColor({ tabId, color: '#E5484D' });
}

async function sendToTab(tabId: number, msg: ContentRequest): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, msg);
  } catch {
    // No content script in this tab (chrome:// pages, Web Store, PDF viewer).
  }
}

function broadcast(msg: Broadcast): void {
  chrome.runtime.sendMessage(msg).catch(() => {
    // No listener (side panel closed) — expected.
  });
}
