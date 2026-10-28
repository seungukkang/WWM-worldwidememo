/**
 * Typed message contracts between content script, background and side panel.
 * Add new messages here first (AGENTS.md §5).
 */
import type { HistoryAction } from '../core/history';
import type { Settings } from '../core/settings';
import type { AnchorState, Annotation, AnnotationStyle, PageRecord } from '../core/types';

/** Requests handled by the background service worker. */
export type BackgroundRequest =
  | { type: 'wwm/list'; pageKey: string }
  | { type: 'wwm/list-pages' }
  /** A user edit; recorded in the page's undo history under `action`. */
  | { type: 'wwm/upsert'; annotation: Annotation; action: HistoryAction }
  | { type: 'wwm/delete'; pageKey: string; id: string }
  | { type: 'wwm/anchor-report'; pageKey: string; results: Array<{ id: string; anchor: AnchorState }> }
  | { type: 'wwm/export' }
  /** Does any stored PDF page belong to this URL? (auto-open in the WWM viewer) */
  | { type: 'wwm/pdf-lookup'; url: string }
  /** Navigate the sender's tab to the WWM PDF viewer for `url`. */
  | { type: 'wwm/open-pdf'; url: string }
  /** Undo the page's last edit; with `expectId`, only if that edit was on this annotation. */
  | { type: 'wwm/undo'; pageKey: string; expectId?: string }
  | { type: 'wwm/redo'; pageKey: string }
  | { type: 'wwm/history'; pageKey: string }
  | { type: 'wwm/settings-set'; patch: Partial<Settings> };

export interface BackgroundResponseMap {
  'wwm/list': { annotations: Annotation[] };
  'wwm/list-pages': { pages: PageRecord[] };
  'wwm/upsert': { annotation: Annotation };
  'wwm/delete': { ok: boolean };
  'wwm/anchor-report': { ok: true };
  'wwm/export': { pages: PageRecord[] };
  'wwm/pdf-lookup': { known: boolean };
  'wwm/open-pdf': { ok: boolean };
  'wwm/undo': { ok: boolean };
  'wwm/redo': { ok: boolean };
  /** The actions the next undo / redo would revert / reapply, if any. */
  'wwm/history': { undo?: HistoryAction; redo?: HistoryAction };
  'wwm/settings-set': { settings: Settings };
}

export type BackgroundResponse<T extends BackgroundRequest['type']> = BackgroundResponseMap[T];

/** Messages delivered to a tab's content script. */
export type ContentRequest =
  | { type: 'wwm/scroll-to'; id: string }
  | { type: 'wwm/refresh' }
  | { type: 'wwm/command'; command: string }
  /** Side panel style bar: annotate the page's current selection. Replies { ok: false } without one. */
  | { type: 'wwm/apply-style'; style: AnnotationStyle }
  | { type: 'wwm/get-status' };

export interface ContentStatus {
  pageKey: string;
  counts: Record<AnchorState['status'], number>;
}

/** Broadcast from background to extension pages (side panel). */
export type Broadcast = { type: 'wwm/changed'; pageKey: string };

export async function sendToBackground<T extends BackgroundRequest>(
  msg: T,
): Promise<BackgroundResponse<T['type']>> {
  const res = (await chrome.runtime.sendMessage(msg)) as BackgroundResponse<T['type']> | { error: string };
  if (res && typeof res === 'object' && 'error' in res) throw new Error(res.error);
  return res as BackgroundResponse<T['type']>;
}
