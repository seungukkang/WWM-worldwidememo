/**
 * Shown on top of Chrome's built-in PDF viewer, which extensions cannot script.
 * Offers to reopen the PDF in the WWM viewer, and does so automatically when
 * the user already has annotations on this PDF.
 */
import { IGNORE_ATTR } from '../core/text-index';
import { t } from '../shared/i18n';
import { sendToBackground } from '../shared/messages';

/** Appended by the WWM viewer's "open in Chrome's viewer" link to skip auto-open. */
export const NATIVE_VIEWER_HASH = 'wwm-native';

const STYLES = `
:host { all: initial; }
.panel {
  position: fixed; z-index: 2147483647; top: 64px; right: 16px;
  display: flex; align-items: center; gap: 8px;
  padding: 8px 8px 8px 12px; border-radius: 10px;
  background: #1f1b2e; color: #f4f1ea;
  box-shadow: 0 6px 24px rgba(0,0,0,.28);
  font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif;
}
button {
  all: unset; cursor: pointer; box-sizing: border-box;
  height: 28px; padding: 0 10px; border-radius: 6px;
  display: inline-flex; align-items: center; font: inherit; font-weight: 600;
}
.primary { background: #ffd600; color: #1f1b2e; }
.primary:hover { background: #ffe14d; }
.close { padding: 0 8px; color: inherit; opacity: .7; }
.close:hover { opacity: 1; background: rgba(255,255,255,.12); }
`;

export function startPdfPrompt(): void {
  const url = location.href.split('#')[0] as string;
  const open = (): void => void sendToBackground({ type: 'wwm/open-pdf', url });

  if (!location.hash.includes(NATIVE_VIEWER_HASH)) {
    void sendToBackground({ type: 'wwm/pdf-lookup', url })
      .then(({ known }) => {
        if (known) open();
      })
      .catch(() => undefined);
  }

  const hostEl = document.createElement('wwm-root');
  hostEl.setAttribute(IGNORE_ATTR, '');
  const root = hostEl.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = STYLES;

  const panel = document.createElement('div');
  panel.className = 'panel';
  const label = document.createElement('span');
  label.textContent = t('pdfPrompt');
  const openBtn = document.createElement('button');
  openBtn.className = 'primary';
  openBtn.textContent = t('pdfOpenInWwm');
  openBtn.addEventListener('click', open);
  const close = document.createElement('button');
  close.className = 'close';
  close.textContent = '×';
  close.title = t('dismiss');
  close.setAttribute('aria-label', t('dismiss'));
  close.addEventListener('click', () => hostEl.remove());
  panel.append(label, openBtn, close);

  root.append(style, panel);
  document.documentElement.append(hostEl);
}
