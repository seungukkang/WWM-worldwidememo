/**
 * In-page UI (floating toolbar, note editor, annotation popover) rendered in a
 * closed Shadow DOM so page CSS cannot leak in and ours cannot leak out.
 */
import { IGNORE_ATTR } from '../core/text-index';
import type { Annotation, AnnotationStyle, HighlightColor } from '../core/types';
import { t, uiLanguage, type MessageKey } from '../shared/i18n';

const COLORS: Array<{ id: HighlightColor; css: string; label: MessageKey }> = [
  { id: 'yellow', css: '#ffd600', label: 'colorYellow' },
  { id: 'green', css: '#30c478', label: 'colorGreen' },
  { id: 'blue', css: '#409cff', label: 'colorBlue' },
  { id: 'pink', css: '#ff5caa', label: 'colorPink' },
];

const STYLES = `
:host { all: initial; }
.panel {
  position: fixed; z-index: 2147483647;
  display: flex; align-items: center; gap: 4px;
  padding: 6px; border-radius: 10px;
  background: #1f1b2e; color: #f4f1ea;
  box-shadow: 0 6px 24px rgba(0,0,0,.28);
  font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif;
}
.panel[hidden] { display: none; }
button {
  all: unset; cursor: pointer; box-sizing: border-box;
  min-width: 28px; height: 28px; padding: 0 6px; border-radius: 6px;
  display: inline-flex; align-items: center; justify-content: center;
  color: inherit; font: inherit; font-weight: 600;
}
button:hover, button:focus-visible { background: rgba(255,255,255,.12); }
.dot { width: 16px; height: 16px; border-radius: 50%; border: 2px solid rgba(255,255,255,.7); }
.sep { width: 1px; height: 18px; background: rgba(255,255,255,.2); margin: 0 2px; }
.u { text-decoration: underline; text-underline-offset: 3px; }
.editor { flex-direction: column; align-items: stretch; width: 300px; gap: 6px; }
textarea {
  all: unset; box-sizing: border-box; width: 100%; min-height: 72px; max-height: 240px;
  padding: 8px; border-radius: 6px; background: #2b2640; color: #f4f1ea;
  font: inherit; white-space: pre-wrap; overflow: auto;
}
.row { display: flex; gap: 4px; justify-content: flex-end; align-items: center; }
.primary { background: #ffd600; color: #1f1b2e; }
.primary:hover { background: #ffe14d; }
.note { max-width: 300px; white-space: pre-wrap; word-break: break-word; padding: 2px 4px; }
.muted { opacity: .65; font-size: 12px; margin-right: auto; }
`;

export interface UiHandlers {
  onApplyStyle(style: AnnotationStyle): void;
  onRequestNote(): void;
  onSaveNote(text: string): void;
  onEdit(id: string): void;
  onDelete(id: string): void;
  onConfirm(id: string): void;
}

export class WwmUi {
  readonly host: HTMLElement;
  private readonly root: ShadowRoot;
  private readonly toolbar: HTMLDivElement;
  private readonly editor: HTMLDivElement;
  private readonly textarea: HTMLTextAreaElement;
  private readonly popover: HTMLDivElement;

  constructor(private readonly h: UiHandlers) {
    this.host = document.createElement('wwm-root');
    this.host.setAttribute(IGNORE_ATTR, '');
    this.root = this.host.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = STYLES;
    this.root.append(style);

    this.toolbar = this.panel('toolbar');
    for (const c of COLORS) {
      const b = this.button('', t('toolbarHighlight', t(c.label)), () => this.h.onApplyStyle({ highlight: c.id }));
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = c.css;
      b.append(dot);
      this.toolbar.append(b);
    }
    this.toolbar.append(this.sep());
    const u = this.button('U', t('toolbarUnderline'), () => this.h.onApplyStyle({ underline: true }));
    u.classList.add('u');
    this.toolbar.append(u, this.button('B', t('toolbarBold'), () => this.h.onApplyStyle({ bold: true })));
    this.toolbar.append(this.sep(), this.button(t('toolbarNote'), t('toolbarNoteTitle'), () => this.h.onRequestNote()));

    this.editor = this.panel('editor');
    this.editor.classList.add('editor');
    this.textarea = document.createElement('textarea');
    this.textarea.placeholder = t('editorPlaceholder');
    this.isolateKeys(this.textarea);
    this.textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.hideAll();
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) this.h.onSaveNote(this.textarea.value);
    });
    const row = document.createElement('div');
    row.className = 'row';
    const save = this.button(t('save'), t('save'), () => this.h.onSaveNote(this.textarea.value));
    save.classList.add('primary');
    row.append(this.button(t('cancel'), t('cancel'), () => this.hideAll()), save);
    this.editor.append(this.textarea, row);

    this.popover = this.panel('popover');
    this.popover.classList.add('editor');

    // Keep the page selection alive while clicking our buttons.
    this.root.addEventListener('mousedown', (e) => {
      if (!(e.target instanceof HTMLTextAreaElement)) e.preventDefault();
    });

    document.documentElement.append(this.host);
  }

  contains(target: EventTarget | null): boolean {
    return target === this.host;
  }

  showToolbar(rect: DOMRect): void {
    this.hideAll();
    this.place(this.toolbar, rect);
  }

  showEditor(rect: DOMRect, initial = ''): void {
    this.hideAll();
    this.textarea.value = initial;
    this.place(this.editor, rect);
    this.textarea.focus();
  }

  showPopover(rect: DOMRect, a: Annotation): void {
    this.hideAll();
    this.popover.replaceChildren();
    if (a.note) {
      const note = document.createElement('div');
      note.className = 'note';
      note.textContent = a.note;
      this.popover.append(note);
    }
    const row = document.createElement('div');
    row.className = 'row';
    const status = document.createElement('span');
    status.className = 'muted';
    status.textContent = statusLabel(a);
    row.append(status);
    if (a.anchor?.status === 'needs-review') {
      const ok = this.button(t('confirmPosition'), t('confirmPositionTitle'), () => this.h.onConfirm(a.id));
      ok.classList.add('primary');
      row.append(ok);
    }
    row.append(
      this.button(t('editNote'), t('editNoteTitle'), () => this.h.onEdit(a.id)),
      this.button(t('delete'), t('deleteTitle'), () => this.h.onDelete(a.id)),
    );
    this.popover.append(row);
    this.place(this.popover, rect);
  }

  hideAll(): void {
    this.toolbar.hidden = true;
    this.editor.hidden = true;
    this.popover.hidden = true;
  }

  isOpen(): boolean {
    return !this.toolbar.hidden || !this.editor.hidden || !this.popover.hidden;
  }

  // -- helpers --------------------------------------------------------------

  private panel(name: string): HTMLDivElement {
    const d = document.createElement('div');
    d.className = 'panel';
    d.dataset.name = name;
    d.hidden = true;
    this.root.append(d);
    return d;
  }

  private button(text: string, title: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.textContent = text;
    b.title = title;
    b.setAttribute('aria-label', title);
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick();
    });
    return b;
  }

  private sep(): HTMLSpanElement {
    const s = document.createElement('span');
    s.className = 'sep';
    return s;
  }

  /** Stop page-level shortcut handlers from seeing keystrokes typed into our UI. */
  private isolateKeys(el: HTMLElement): void {
    for (const type of ['keydown', 'keyup', 'keypress'] as const) {
      el.addEventListener(type, (e) => e.stopPropagation());
    }
  }

  private place(el: HTMLElement, rect: DOMRect): void {
    el.hidden = false;
    const { width, height } = el.getBoundingClientRect();
    const margin = 8;
    let top = rect.top - height - margin;
    if (top < margin) top = rect.bottom + margin;
    const maxLeft = window.innerWidth - width - margin;
    const left = Math.max(margin, Math.min(rect.left + rect.width / 2 - width / 2, maxLeft));
    el.style.top = `${Math.round(top)}px`;
    el.style.left = `${Math.round(left)}px`;
  }
}

function statusLabel(a: Annotation): string {
  switch (a.anchor?.status) {
    case 'moved':
      return t('statusMoved');
    case 'needs-review':
      return t('statusNeedsReview');
    default:
      return new Date(a.createdAt).toLocaleDateString(uiLanguage());
  }
}
