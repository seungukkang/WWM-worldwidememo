/**
 * Background service worker: single writer for storage, message router,
 * badge updates, context menu and keyboard-command relay.
 *
 * MV3 service workers are terminated when idle — keep no state in memory
 * that cannot be rebuilt from storage.
 */
import { AnnotationRepository, type KVStore } from '../core/repository';
import type { AnchorState } from '../core/types';
import { isPdfPageKey, normalizePageKey } from '../core/url';
import { t } from '../shared/i18n';
import type { BackgroundRequest, Broadcast, ContentRequest } from '../shared/messages';
import { pdfViewerUrl } from '../shared/pdf';

class ChromeLocalKV implements KVStore {
  async get<T>(key: string): Promise<T | undefined> {
    const res = await chrome.storage.local.get(key);
    return res[key] as T | undefined;
  }
  async set(entries: Record<string, unknown>): Promise<void> {
    await chrome.storage.local.set(entries);
  }
  async remove(keys: string[]): Promise<void> {
    await chrome.storage.local.remove(keys);
  }
}

const repo = new AnnotationRepository(new ChromeLocalKV());

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
  handle(msg, sender)
    .then(sendResponse)
    .catch((err: unknown) => sendResponse({ error: err instanceof Error ? err.message : String(err) }));
  return true; // async response
});

async function handle(msg: BackgroundRequest, sender: chrome.runtime.MessageSender): Promise<unknown> {
  switch (msg.type) {
    case 'wwm/list':
      return { annotations: await repo.list(msg.pageKey) };

    case 'wwm/list-pages':
      return { pages: await repo.listPages() };

    case 'wwm/upsert': {
      const annotation = await repo.upsert({ ...msg.annotation, updatedAt: new Date().toISOString() });
      broadcast({ type: 'wwm/changed', pageKey: annotation.pageKey });
      return { annotation };
    }

    case 'wwm/delete': {
      const ok = await repo.remove(msg.pageKey, msg.id);
      broadcast({ type: 'wwm/changed', pageKey: msg.pageKey });
      return { ok };
    }

    case 'wwm/anchor-report': {
      await applyAnchorReport(msg.pageKey, msg.results);
      if (sender.tab?.id !== undefined) await updateBadge(sender.tab.id, msg.results.map((r) => r.anchor));
      broadcast({ type: 'wwm/changed', pageKey: msg.pageKey });
      return { ok: true };
    }

    case 'wwm/export':
      return { pages: await repo.exportAll() };

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
