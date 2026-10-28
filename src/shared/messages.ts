/**
 * Typed message contracts between content script, background and side panel.
 * Add new messages here first (AGENTS.md §5).
 */
import type { AnchorState, Annotation, PageRecord } from '../core/types';

/** Requests handled by the background service worker. */
export type BackgroundRequest =
  | { type: 'wwm/list'; pageKey: string }
  | { type: 'wwm/list-pages' }
  | { type: 'wwm/upsert'; annotation: Annotation }
  | { type: 'wwm/delete'; pageKey: string; id: string }
  | { type: 'wwm/anchor-report'; pageKey: string; results: Array<{ id: string; anchor: AnchorState }> }
  | { type: 'wwm/export' };

export interface BackgroundResponseMap {
  'wwm/list': { annotations: Annotation[] };
  'wwm/list-pages': { pages: PageRecord[] };
  'wwm/upsert': { annotation: Annotation };
  'wwm/delete': { ok: boolean };
  'wwm/anchor-report': { ok: true };
  'wwm/export': { pages: PageRecord[] };
}

export type BackgroundResponse<T extends BackgroundRequest['type']> = BackgroundResponseMap[T];

/** Messages delivered to a tab's content script. */
export type ContentRequest =
  | { type: 'wwm/scroll-to'; id: string }
  | { type: 'wwm/refresh' }
  | { type: 'wwm/command'; command: string }
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
