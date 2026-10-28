/**
 * Table of contents (PDF outline / bookmarks) for the WWM viewer sidebar.
 */
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { ViewerLinkService } from './link-service';

type OutlineItem = Awaited<ReturnType<PDFDocumentProxy['getOutline']>>[number];

/** Render the outline into `container`. Returns false when the PDF has none. */
export async function renderOutline(
  doc: PDFDocumentProxy,
  container: HTMLElement,
  links: ViewerLinkService,
): Promise<boolean> {
  const outline = await doc.getOutline().catch(() => null);
  if (!outline || outline.length === 0) return false;
  container.replaceChildren(buildList(outline, links, 0));
  return true;
}

function buildList(items: OutlineItem[], links: ViewerLinkService, depth: number): HTMLUListElement {
  const ul = document.createElement('ul');
  for (const item of items) {
    const li = document.createElement('li');
    const row = document.createElement('div');
    row.className = 'row';

    const children = item.items.length > 0 ? buildList(item.items, links, depth + 1) : null;
    const toggle = document.createElement('button');
    toggle.className = 'toggle';
    toggle.tabIndex = -1;
    if (children) {
      const open = depth === 0;
      children.hidden = !open;
      toggle.textContent = open ? '▾' : '▸';
      toggle.addEventListener('click', () => {
        children.hidden = !children.hidden;
        toggle.textContent = children.hidden ? '▸' : '▾';
      });
    } else {
      toggle.disabled = true;
    }

    const title = document.createElement('button');
    title.className = 'title';
    title.textContent = item.title;
    title.title = item.title;
    if (item.bold) title.style.fontWeight = '700';
    if (item.italic) title.style.fontStyle = 'italic';
    title.addEventListener('click', () => {
      if (item.dest) void links.goToDestination(item.dest);
      else if (item.url) window.open(item.url, '_blank', 'noopener');
    });

    row.append(toggle, title);
    li.append(row);
    if (children) li.append(children);
    ul.append(li);
  }
  return ul;
}
