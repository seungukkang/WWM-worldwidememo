/**
 * Page rendering for the WWM PDF viewer: one canvas + text layer + link layer
 * per page, zoom, page navigation, print and download.
 *
 * Text layers for every page are built up front (anchoring needs the whole
 * document's text) and are never rebuilt: zoom re-lays out the same nodes via
 * TextLayer.update(), so annotation Ranges stay valid. Canvases are painted
 * lazily as pages scroll into view and repainted after a zoom change.
 */
import {
  AnnotationLayer,
  TextLayer,
  type PageViewport,
  type PDFDocumentProxy,
  type PDFPageProxy,
} from 'pdfjs-dist/legacy/build/pdf.mjs';
import { IGNORE_ATTR } from '../core/text-index';
import { ViewerLinkService, type NavigationTarget } from './link-service';

/** pdf.js scale 1 is 1 CSS px per PDF point; "100%" zoom is actual size (96 dpi). */
export const CSS_UNITS = 96 / 72;
const ZOOM_STEPS = [0.25, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];
const MAX_FIT_ZOOM = 1.3;
const MAX_PAGE_WIDTH = 1100;
const CANVAS_PRELOAD_MARGIN = '1200px';
const PRINT_SCALE = 2; // ≈144 dpi
/** Height of the sticky toolbar plus a small gap. */
export const TOP_GAP = 56;

interface PageState {
  proxy: PDFPageProxy;
  el: HTMLElement;
  text: TextLayer;
  links: AnnotationLayer | null;
  /** Text nodes we appended a word-break space to (see addWordBreaks). */
  eol: Text[];
  viewport: PageViewport;
  /** Scale the current canvas was painted at; 0 = not painted. */
  paintedScale: number;
  painting: boolean;
}

export interface ViewPosition {
  index: number;
  /** Fraction of the page height scrolled past the top gap. */
  ratio: number;
}

export class PdfView implements NavigationTarget {
  readonly linkService: ViewerLinkService;
  onPageChange: (index: number) => void = () => undefined;
  onZoomChange: (zoom: number) => void = () => undefined;

  private readonly pages: PageState[] = [];
  private scale = 1;
  private readonly observer: IntersectionObserver;

  constructor(
    private readonly doc: PDFDocumentProxy,
    private readonly root: HTMLElement,
  ) {
    this.linkService = new ViewerLinkService(doc, this);
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const state = this.pages.find((p) => p.el === entry.target);
          if (state) void this.paint(state);
        }
      },
      { rootMargin: CANVAS_PRELOAD_MARGIN },
    );
    let ticking = false;
    window.addEventListener('scroll', () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        this.onPageChange(this.currentPageIndex());
      });
    });
  }

  get pageCount(): number {
    return this.doc.numPages;
  }

  /** Current zoom as a fraction of actual size (1 = 100%). */
  get zoom(): number {
    return this.scale / CSS_UNITS;
  }

  async load(): Promise<void> {
    const first = await this.doc.getPage(1);
    this.scale = this.fitWidthScale(first);
    for (let n = 1; n <= this.doc.numPages; n++) {
      const proxy = n === 1 ? first : await this.doc.getPage(n);
      this.pages.push(await this.buildPage(proxy, n));
    }
    this.onZoomChange(this.zoom);
    this.onPageChange(this.currentPageIndex());
  }

  // -- zoom -----------------------------------------------------------------

  zoomIn(): Promise<void> {
    const next = ZOOM_STEPS.find((z) => z > this.zoom + 0.001) ?? this.zoom;
    return this.setScale(next * CSS_UNITS);
  }

  zoomOut(): Promise<void> {
    const prev = [...ZOOM_STEPS].reverse().find((z) => z < this.zoom - 0.001) ?? this.zoom;
    return this.setScale(prev * CSS_UNITS);
  }

  fitWidth(): Promise<void> {
    const first = this.pages[0]?.proxy;
    return first ? this.setScale(this.fitWidthScale(first)) : Promise.resolve();
  }

  async setScale(scale: number): Promise<void> {
    if (Math.abs(scale - this.scale) < 1e-6) return;
    const pos = this.position();
    this.scale = scale;
    for (const state of this.pages) this.relayout(state);
    this.restore(pos);
    this.onZoomChange(this.zoom);
    // Repaint whatever is visible now; the observer handles the rest on scroll.
    for (const state of this.pages) if (isNearViewport(state.el)) void this.paint(state);
  }

  // -- navigation (NavigationTarget) ----------------------------------------

  currentPageIndex(): number {
    const probe = TOP_GAP + (window.innerHeight - TOP_GAP) / 3;
    const i = this.pages.findIndex((p) => p.el.getBoundingClientRect().bottom > probe);
    return i < 0 ? this.pages.length - 1 : i;
  }

  viewportOf(index: number): PageViewport | undefined {
    return this.pages[index]?.viewport;
  }

  scrollToPage(index: number, offsetY = 0): void {
    const state = this.pages[Math.max(0, Math.min(index, this.pages.length - 1))];
    if (!state) return;
    const top = state.el.getBoundingClientRect().top + window.scrollY + offsetY - TOP_GAP;
    window.scrollTo({ top: Math.max(0, top) });
  }

  jumpTo(index: number, offsetY = 0): void {
    // Remember where we were on the current history entry, then add an entry
    // for the destination, so Back (button, Alt+←, mouse) returns here.
    history.replaceState({ ...asObject(history.state), wwmPos: this.position() }, '');
    this.scrollToPage(index, offsetY);
    history.pushState({ wwmPos: this.position() }, '');
  }

  position(): ViewPosition {
    const index = this.currentPageIndex();
    const rect = this.pages[index]?.el.getBoundingClientRect();
    const ratio = rect && rect.height > 0 ? (TOP_GAP - rect.top) / rect.height : 0;
    return { index, ratio };
  }

  restore(pos: ViewPosition): void {
    const state = this.pages[pos.index];
    if (!state) return;
    this.scrollToPage(pos.index, pos.ratio * state.el.getBoundingClientRect().height);
  }

  // -- print / download -----------------------------------------------------

  /**
   * Print every page at print resolution. Printing the live view would leave
   * not-yet-painted pages blank, so pages are rendered to images first.
   */
  async print(): Promise<void> {
    const container = document.createElement('div');
    container.id = 'print-pages';
    container.setAttribute(IGNORE_ATTR, '');
    const urls: string[] = [];
    for (const state of this.pages) {
      const viewport = state.proxy.getViewport({ scale: PRINT_SCALE * CSS_UNITS });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      await state.proxy.render({ canvas, viewport, intent: 'print' }).promise;
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve));
      if (!blob) continue;
      const img = document.createElement('img');
      const url = URL.createObjectURL(blob);
      urls.push(url);
      img.src = url;
      container.append(img);
    }
    document.body.append(container);
    await Promise.all([...container.querySelectorAll('img')].map((img) => img.decode().catch(() => undefined)));
    const cleanup = (): void => {
      container.remove();
      for (const url of urls) URL.revokeObjectURL(url);
    };
    window.addEventListener('afterprint', cleanup, { once: true });
    window.print();
  }

  async download(fileName: string): Promise<void> {
    const data = await this.doc.getData();
    const url = URL.createObjectURL(new Blob([data as BlobPart], { type: 'application/pdf' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = /\.pdf$/i.test(fileName) ? fileName : `${fileName}.pdf`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  // -- internals ------------------------------------------------------------

  private fitWidthScale(page: PDFPageProxy): number {
    const available = Math.min(document.documentElement.clientWidth, MAX_PAGE_WIDTH) - 32;
    return Math.min(MAX_FIT_ZOOM * CSS_UNITS, available / page.getViewport({ scale: 1 }).width);
  }

  private async buildPage(proxy: PDFPageProxy, n: number): Promise<PageState> {
    const viewport = proxy.getViewport({ scale: this.scale });
    const el = document.createElement('div');
    el.className = 'page';
    el.dataset.page = String(n);
    const textEl = document.createElement('div');
    textEl.className = 'textLayer';
    el.append(textEl);
    this.root.append(el);

    const text = new TextLayer({ textContentSource: await proxy.getTextContent(), container: textEl, viewport });
    await text.render();
    const state: PageState = {
      proxy,
      el,
      text,
      links: null,
      eol: addWordBreaks(textEl),
      viewport,
      paintedScale: 0,
      painting: false,
    };
    sizePage(el, viewport, this.scale);
    enableSelectionHelpers(textEl);
    state.links = await this.buildLinks(proxy, viewport, el).catch((err: unknown) => {
      console.warn('[WWM] link layer failed', err);
      return null;
    });
    this.observer.observe(el);
    return state;
  }

  /**
   * Links (internal destinations, URLs, mailto). The layer sits above the text
   * layer and is excluded from WWM's text index so link/popup text never shifts
   * annotation offsets.
   */
  private async buildLinks(proxy: PDFPageProxy, viewport: PageViewport, pageEl: HTMLElement): Promise<AnnotationLayer | null> {
    const annotations = await proxy.getAnnotations({ intent: 'display' });
    if (annotations.length === 0) return null;
    const div = document.createElement('div');
    div.className = 'annotationLayer';
    div.setAttribute(IGNORE_ATTR, '');
    pageEl.append(div);
    const layer = new AnnotationLayer({
      div,
      accessibilityManager: null,
      annotationCanvasMap: null,
      annotationEditorUIManager: null,
      page: proxy,
      viewport: viewport.clone({ dontFlip: true }),
      structTreeLayer: null,
      commentManager: null,
      linkService: this.linkService,
      annotationStorage: null,
    });
    // pdf.js types the service as its full PDFLinkService; links only call the subset we implement.
    const linkService = this.linkService as unknown as Parameters<AnnotationLayer['render']>[0]['linkService'];
    await layer.render({ annotations, renderForms: false, enableScripting: false, viewport, div, page: proxy, linkService });
    return layer;
  }

  private relayout(state: PageState): void {
    state.viewport = state.proxy.getViewport({ scale: this.scale });
    sizePage(state.el, state.viewport, this.scale);
    // TextLayer measures each span's text to fit its PDF width; our appended
    // word-break spaces must not count, so take them out while it re-measures.
    for (const t of state.eol) t.deleteData(t.length - 1, 1);
    state.text.update({ viewport: state.viewport });
    for (const t of state.eol) t.appendData(' ');
    // update() only reads `viewport`; its declared type reuses the render() parameters.
    state.links?.update({ viewport: state.viewport.clone({ dontFlip: true }) } as Parameters<AnnotationLayer['update']>[0]);
  }

  private async paint(state: PageState): Promise<void> {
    if (state.painting || state.paintedScale === this.scale) return;
    state.painting = true;
    const scale = this.scale;
    try {
      const viewport = state.proxy.getViewport({ scale: scale * (window.devicePixelRatio || 1) });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      await state.proxy.render({ canvas, viewport }).promise;
      // Swap only when done, so zooming never flashes a blank page.
      state.el.querySelector('canvas')?.remove();
      state.el.prepend(canvas);
      state.paintedScale = scale;
    } catch (err) {
      console.warn('[WWM] page render failed', err);
    } finally {
      state.painting = false;
    }
    if (state.paintedScale !== this.scale && isNearViewport(state.el)) void this.paint(state);
  }
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function sizePage(el: HTMLElement, viewport: PageViewport, scale: number): void {
  el.style.width = `${Math.floor(viewport.width)}px`;
  el.style.height = `${Math.floor(viewport.height)}px`;
  el.style.setProperty('--scale-factor', String(scale));
  el.style.setProperty('--total-scale-factor', String(scale));
  el.style.setProperty('--scale-round-x', '1px');
  el.style.setProperty('--scale-round-y', '1px');
}

function isNearViewport(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  return r.bottom > -window.innerHeight && r.top < window.innerHeight * 2;
}

/**
 * Line ends in the text layer are <br> elements, which contribute no text, so
 * "end of line" + "next line" would read as one word. Append a space to the
 * last text span of each line (and of the page) so quotes and fuzzy matching
 * see words. The space goes inside the positioned span: a separate element
 * would sit at the page origin and distort selection and toolbar placement.
 * Hyphenated line breaks are left joined ("trans-" + "duction").
 */
function addWordBreaks(layer: HTMLElement): Text[] {
  const changed: Text[] = [];
  const appendSpace = (el: Element | null): void => {
    let span = el;
    while (span && !(span.tagName === 'SPAN' && !span.classList.contains('markedContent'))) {
      span = span.lastElementChild;
    }
    const text = span?.lastChild;
    if (!text || text.nodeType !== Node.TEXT_NODE) return;
    const t = text as Text;
    if (/[\s-]$/.test(t.data)) return;
    t.appendData(' ');
    changed.push(t);
  };
  for (const br of layer.querySelectorAll('br')) appendSpace(br.previousElementSibling);
  appendSpace(layer.lastElementChild);
  return changed;
}

/** pdf.js TextLayerBuilder's trick so drag-selection doesn't jump past the text. */
function enableSelectionHelpers(layer: HTMLElement): void {
  const end = document.createElement('div');
  end.className = 'endOfContent';
  layer.append(end);
  layer.addEventListener('mousedown', () => layer.classList.add('selecting'));
  document.addEventListener('mouseup', () => layer.classList.remove('selecting'));
}
