/**
 * Content script entry. Web pages get the annotator directly; Chrome's built-in
 * PDF viewer cannot be scripted, so PDFs get a prompt to reopen them in the
 * WWM viewer instead (src/pdf/).
 */
import { normalizePageKey } from '../core/url';
import { startAnnotator } from './annotator';
import { startPdfPrompt } from './pdf-prompt';

function start(): void {
  if (document.contentType === 'application/pdf') {
    startPdfPrompt();
    return;
  }
  startAnnotator({
    root: () => document.body,
    pageKey: () => normalizePageKey(location.href),
    url: () => location.href,
    title: () => document.title,
  });
}

if (document.body) start();
else document.addEventListener('DOMContentLoaded', start, { once: true });
