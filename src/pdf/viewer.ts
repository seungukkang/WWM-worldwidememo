/**
 * WWM PDF viewer. Chrome's built-in PDF viewer cannot be scripted by extensions,
 * so PDFs are reopened here: pdf.js renders each page to a canvas plus a
 * transparent text layer, and the shared annotator works on that text layer
 * exactly as it does on a web page. Page identity is the PDF fingerprint.
 *
 * Keeps the basics of Chrome's viewer: links, zoom, page number, outline,
 * download and print.
 *
 * pdf.js is bundled (legacy build for older Chrome); worker, cmaps, fonts and
 * wasm decoders are packaged files — no remote code.
 */
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { startAnnotator } from '../content/annotator';
import { NATIVE_VIEWER_HASH } from '../content/pdf-prompt';
import { pdfPageKey } from '../core/url';
import { localizeDocument, t, uiLanguage } from '../shared/i18n';
import { renderOutline } from './outline';
import { PdfView, type ViewPosition } from './pdf-view';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('pdf/pdf.worker.mjs');

function pdfUrlFromQuery(): string | null {
  const raw = new URLSearchParams(location.search).get('file');
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function fileName(url: string): string {
  const last = new URL(url).pathname.split('/').filter(Boolean).pop();
  return last ? decodeURIComponent(last) : url;
}

async function documentTitle(doc: PDFDocumentProxy, url: string): Promise<string> {
  try {
    const { info } = await doc.getMetadata();
    const title = (info as { Title?: unknown } | undefined)?.Title;
    if (typeof title === 'string' && title.trim()) return title.trim();
  } catch {
    // Metadata is optional.
  }
  return fileName(url);
}

function setupToolbar(view: PdfView, url: string): void {
  const pageInput = $<HTMLInputElement>('page-input');
  $('page-count').textContent = String(view.pageCount);
  view.onPageChange = (index) => {
    if (document.activeElement !== pageInput) pageInput.value = String(index + 1);
  };
  const goToTypedPage = (): void => {
    const n = Number.parseInt(pageInput.value, 10);
    if (Number.isInteger(n) && n >= 1 && n <= view.pageCount) {
      view.jumpTo(n - 1);
    }
    pageInput.value = String(view.currentPageIndex() + 1);
  };
  pageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      goToTypedPage();
      pageInput.blur();
    }
  });
  pageInput.addEventListener('focus', () => pageInput.select());
  pageInput.addEventListener('blur', () => (pageInput.value = String(view.currentPageIndex() + 1)));

  view.onZoomChange = (zoom) => ($('zoom-level').textContent = `${Math.round(zoom * 100)}%`);
  $('zoom-in').addEventListener('click', () => void view.zoomIn());
  $('zoom-out').addEventListener('click', () => void view.zoomOut());
  $('zoom-fit').addEventListener('click', () => void view.fitWidth());

  const print = (): void => {
    const button = $<HTMLButtonElement>('print');
    if (button.disabled) return;
    button.disabled = true;
    document.body.classList.add('busy');
    void view.print().finally(() => {
      button.disabled = false;
      document.body.classList.remove('busy');
    });
  };
  $('print').addEventListener('click', print);
  $('download').addEventListener('click', () => void view.download(fileName(url)));

  // Keyboard and ctrl/⌘ + wheel zoom act on the PDF (re-rendered sharply),
  // like Chrome's viewer, instead of zooming the whole page.
  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    if (e.key === '=' || e.key === '+') void view.zoomIn();
    else if (e.key === '-') void view.zoomOut();
    else if (e.key === '0') void view.fitWidth();
    else if (e.key === 'p') print();
    else return;
    e.preventDefault();
  });
  let wheelLock = false;
  window.addEventListener(
    'wheel',
    (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      if (wheelLock) return;
      wheelLock = true;
      void (e.deltaY < 0 ? view.zoomIn() : view.zoomOut()).finally(() =>
        setTimeout(() => (wheelLock = false), 120),
      );
    },
    { passive: false },
  );

  // Back/forward after following an internal link. Positions are stored per
  // page (they survive zoom), so the browser's own pixel restore must not run.
  history.scrollRestoration = 'manual';
  window.addEventListener('popstate', (e) => {
    const pos = (e.state as { wwmPos?: ViewPosition } | null)?.wwmPos;
    if (pos) view.restore(pos);
  });
}

async function setupOutline(doc: PDFDocumentProxy, view: PdfView): Promise<void> {
  const panel = $('outline');
  if (!(await renderOutline(doc, panel, view.linkService))) return;
  const toggle = $<HTMLButtonElement>('outline-toggle');
  toggle.hidden = false;
  toggle.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    document.body.classList.toggle('outline-open', !panel.hidden);
    toggle.setAttribute('aria-pressed', String(!panel.hidden));
  });
}

async function main(): Promise<void> {
  document.documentElement.lang = uiLanguage();
  localizeDocument();
  const status = $('status');
  const url = pdfUrlFromQuery();
  if (!url) {
    status.textContent = t('pdfLoadError');
    return;
  }
  $<HTMLAnchorElement>('native').href = `${url}#${NATIVE_VIEWER_HASH}`;
  $('title').textContent = fileName(url);

  try {
    const doc = await getDocument({
      url,
      withCredentials: true,
      cMapUrl: chrome.runtime.getURL('pdf/cmaps/'),
      cMapPacked: true,
      standardFontDataUrl: chrome.runtime.getURL('pdf/standard_fonts/'),
      wasmUrl: chrome.runtime.getURL('pdf/wasm/'),
      enableXfa: false,
    }).promise;

    const title = await documentTitle(doc, url);
    document.title = title;
    $('title').textContent = title;

    const pages = $('pages');
    const view = new PdfView(doc, pages);
    setupToolbar(view, url);
    await view.load();
    status.hidden = true;
    void setupOutline(doc, view);

    const fingerprint = doc.fingerprints[0] ?? url;
    startAnnotator({
      root: () => pages,
      pageKey: () => pdfPageKey(fingerprint),
      url: () => url,
      title: () => title,
    });
  } catch (err) {
    console.warn('[WWM] PDF load failed', err);
    status.textContent = t('pdfLoadError');
  }
}

void main();
