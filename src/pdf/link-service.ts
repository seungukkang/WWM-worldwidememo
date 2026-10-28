/**
 * Minimal pdf.js link service for the WWM viewer, so links inside the PDF work
 * like in Chrome's viewer: internal links (references, footnotes, figures)
 * scroll to their destination (and Back returns), web links open in a new tab,
 * mailto: opens the mail client. Implements the subset of pdf.js'
 * IPDFLinkService that AnnotationLayer's link elements and the outline call.
 */
import type { PageViewport, PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';

/** What the link service needs from the page view. */
export interface NavigationTarget {
  readonly pageCount: number;
  currentPageIndex(): number;
  viewportOf(index: number): PageViewport | undefined;
  /** Scroll so that `offsetY` CSS px into page `index` is at the top. */
  scrollToPage(index: number, offsetY?: number): void;
  /** Like scrollToPage, but recorded in browser history so Back returns. */
  jumpTo(index: number, offsetY?: number): void;
}

type ExplicitDest = [unknown, { name: string } | null, ...Array<number | null>];

export class ViewerLinkService {
  readonly externalLinkEnabled = true;
  readonly eventBus = null;

  constructor(
    private readonly doc: PDFDocumentProxy,
    private readonly view: NavigationTarget,
  ) {}

  addLinkAttributes(link: HTMLAnchorElement, url: string, _newWindow?: boolean): void {
    link.href = url;
    link.title = url;
    if (/^https?:/i.test(url)) {
      link.target = '_blank';
      link.rel = 'noopener noreferrer nofollow';
    }
  }

  getDestinationHash(_dest: unknown): string {
    return '#';
  }

  getAnchorUrl(hash: string): string {
    return `#${hash}`;
  }

  async goToDestination(dest: string | unknown[]): Promise<void> {
    const explicit = (typeof dest === 'string' ? await this.doc.getDestination(dest) : dest) as ExplicitDest | null;
    if (!Array.isArray(explicit)) return;
    const pageIndex = await this.pageIndexOf(explicit[0]);
    if (pageIndex === undefined) return;
    this.view.jumpTo(pageIndex, this.destinationY(explicit, pageIndex));
  }

  goToPage(pageNumber: number): void {
    this.view.jumpTo(pageNumber - 1);
  }

  executeNamedAction(action: string): void {
    const current = this.view.currentPageIndex();
    switch (action) {
      case 'NextPage':
        this.view.scrollToPage(current + 1);
        break;
      case 'PrevPage':
        this.view.scrollToPage(current - 1);
        break;
      case 'FirstPage':
        this.view.jumpTo(0);
        break;
      case 'LastPage':
        this.view.jumpTo(this.view.pageCount - 1);
        break;
      case 'GoBack':
        history.back();
        break;
      case 'GoForward':
        history.forward();
        break;
    }
  }

  executeSetOCGState(_action: unknown): void {
    // Optional content (layers) toggling is not supported.
  }

  async getAttachmentContent(_id: string): Promise<null> {
    return null;
  }

  private async pageIndexOf(ref: unknown): Promise<number | undefined> {
    if (Number.isInteger(ref)) return ref as number;
    if (ref && typeof ref === 'object') {
      try {
        return await this.doc.getPageIndex(ref as Parameters<PDFDocumentProxy['getPageIndex']>[0]);
      } catch {
        return undefined;
      }
    }
    return undefined;
  }

  /** Y offset (CSS px) of the destination within its page, if the destination has one. */
  private destinationY(dest: ExplicitDest, pageIndex: number): number {
    const viewport = this.view.viewportOf(pageIndex);
    const mode = dest[1]?.name;
    let top: number | null | undefined;
    if (mode === 'XYZ') top = dest[3];
    else if (mode === 'FitH' || mode === 'FitBH') top = dest[2];
    else if (mode === 'FitR') top = dest[5];
    if (!viewport || typeof top !== 'number') return 0;
    const [, y] = viewport.convertToViewportPoint(0, top);
    return Math.max(0, y);
  }
}
