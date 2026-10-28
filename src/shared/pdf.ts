/** URLs of the bundled PDF viewer (src/pdf/). */

export function pdfViewerUrl(pdfUrl: string): string {
  return `${chrome.runtime.getURL('pdf/viewer.html')}?file=${encodeURIComponent(pdfUrl)}`;
}
