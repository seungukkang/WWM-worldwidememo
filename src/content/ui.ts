/**
 * In-page UI (floating toolbar, note editor, annotation popover) rendered in a
 * closed Shadow DOM so page CSS cannot leak in and ours cannot leak out.
 *
 * The toolbar follows the user's settings: full toolbar, a small launcher icon
 * that expands into it, or nothing (the side panel's style bar is used);
 * above or below the selection; opacity. A handle lets the user drag it out of
 * the way of the site's own toolbar; the dragged position lasts until it closes.
 */
import { DEFAULT_SETTINGS, type Settings, type ToolbarPlacement } from '../core/settings';
import { IGNORE_ATTR } from '../core/text-index';
import { toggleStyle, type StyleChange } from '../core/style';
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
.styles { display: flex; align-items: center; gap: 4px; }
button.on { background: rgba(255,255,255,.18); box-shadow: inset 0 0 0 1.5px rgba(255,255,255,.85); }
button:disabled { cursor: default; opacity: .45; }
.panel[data-name="toolbar"], .panel[data-name="launcher"] { opacity: var(--wwm-opacity, 1); transition: opacity .12s; }
.panel[data-name="toolbar"]:hover, .panel[data-name="toolbar"]:focus-within,
.panel[data-name="launcher"]:hover { opacity: 1; }
.grip {
  display: inline-flex; align-items: center; justify-content: center; width: 14px; height: 28px;
  margin-right: 2px; cursor: grab; color: rgba(255,255,255,.55); touch-action: none;
}
.grip:active { cursor: grabbing; }
.grip svg { width: 8px; height: 16px; fill: currentColor; }
.panel[data-name="launcher"] { padding: 3px; border-radius: 999px; }
.launch { min-width: 22px; width: 22px; height: 22px; padding: 0; border-radius: 999px; background: #ffd600; color: #1f1b2e; font-size: 11px; font-weight: 800; }
.launch:hover { background: #ffe14d; }
.toast {
  top: auto; left: 50%; bottom: 24px; transform: translateX(-50%);
  padding: 6px 6px 6px 14px; gap: 10px;
}
`;

export interface UiHandlers {
  onApplyStyle(style: AnnotationStyle): void;
  onRequestNote(): void;
  onSaveNote(text: string): void;
  onEdit(id: string): void;
  onDelete(id: string): void;
  onConfirm(id: string): void;
  onChangeStyle(id: string, change: StyleChange): void;
}

export class WwmUi {
  readonly host: HTMLElement;
  private readonly root: ShadowRoot;
  private readonly toolbar: HTMLDivElement;
  private readonly editor: HTMLDivElement;
  private readonly textarea: HTMLTextAreaElement;
  private readonly popover: HTMLDivElement;
  private readonly toast: HTMLDivElement;
  private readonly launcher: HTMLDivElement;
  private settings: Settings = DEFAULT_SETTINGS;
  private selectionRect: DOMRect | null = null;
  private popoverRect: DOMRect | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly h: UiHandlers) {
    this.host = document.createElement('wwm-root');
    this.host.setAttribute(IGNORE_ATTR, '');
    this.root = this.host.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = STYLES;
    this.root.append(style);

    this.toolbar = this.panel('toolbar');
    this.toolbar.append(this.grip());
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

    this.toast = this.panel('toast');
    this.toast.classList.add('toast');

    // Compact mode: a small icon at the end of the selection that opens the toolbar.
    this.launcher = this.panel('launcher');
    const launch = this.button('W', t('launcherTitle'), () => this.expandLauncher());
    launch.classList.add('launch');
    launch.addEventListener('pointerenter', () => this.expandLauncher());
    this.launcher.append(launch);

    // Keep the page selection alive while clicking our buttons.
    this.root.addEventListener('mousedown', (e) => {
      if (!(e.target instanceof HTMLTextAreaElement)) e.preventDefault();
    });

    document.documentElement.append(this.host);
  }

  contains(target: EventTarget | null): boolean {
    return target === this.host;
  }

  applySettings(s: Settings): void {
    this.settings = s;
    for (const el of [this.toolbar, this.launcher]) el.style.setProperty('--wwm-opacity', String(s.toolbarOpacity));
  }

  /** Always opens at its default place next to the selection (a dragged position is not kept). */
  showToolbar(rect: DOMRect): void {
    this.hideAll();
    this.selectionRect = rect;
    this.place(this.toolbar, rect, this.settings.toolbarPlacement);
  }

  /** Compact mode: `last` is the selection's last line box; the icon sits at its end. */
  showLauncher(rect: DOMRect, last: DOMRect): void {
    this.hideAll();
    this.selectionRect = rect;
    const el = this.launcher;
    el.hidden = false;
    const { width, height } = el.getBoundingClientRect();
    const margin = 4;
    const below = this.settings.toolbarPlacement === 'below';
    let top = below ? last.bottom + margin : last.top - height - margin;
    if (top < margin || top + height > window.innerHeight - margin) top = below ? last.top - height - margin : last.bottom + margin;
    const left = Math.max(margin, Math.min(last.right + margin, window.innerWidth - width - margin));
    el.style.top = `${Math.round(top)}px`;
    el.style.left = `${Math.round(left)}px`;
  }

  private expandLauncher(): void {
    if (!this.launcher.hidden && this.selectionRect) this.showToolbar(this.selectionRect);
  }

  showEditor(rect: DOMRect, initial = ''): void {
    this.hideAll();
    this.textarea.value = initial;
    this.place(this.editor, rect);
    this.textarea.focus();
  }

  showPopover(rect: DOMRect, a: Annotation): void {
    this.hideAll();
    this.popoverRect = rect;
    this.popover.replaceChildren(this.styleRow(a));
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
    const noteLabel = a.note ? t('editNote') : t('addNote');
    row.append(
      this.button(noteLabel, noteLabel, () => this.h.onEdit(a.id)),
      this.button(t('delete'), t('deleteTitle'), () => this.h.onDelete(a.id)),
    );
    this.popover.append(row);
    this.place(this.popover, rect);
  }

  /** Re-render an open popover after its annotation changed (e.g. a style edit). */
  refreshPopover(a: Annotation): void {
    if (!this.popover.hidden && this.popoverRect) this.showPopover(this.popoverRect, a);
  }

  /** Brief message at the bottom of the viewport, with an optional action (e.g. Undo). */
  showToast(message: string, action?: { label: string; run: () => void }, ms = 6000): void {
    clearTimeout(this.toastTimer);
    const text = document.createElement('span');
    text.textContent = message;
    this.toast.replaceChildren(text);
    if (action) {
      const b = this.button(action.label, action.label, () => {
        this.hideToast();
        action.run();
      });
      b.classList.add('primary');
      this.toast.append(b);
    }
    this.toast.hidden = false;
    this.toastTimer = setTimeout(() => this.hideToast(), ms);
  }

  hideToast(): void {
    clearTimeout(this.toastTimer);
    this.toast.hidden = true;
  }

  hideAll(): void {
    this.toolbar.hidden = true;
    this.launcher.hidden = true;
    this.editor.hidden = true;
    this.popover.hidden = true;
  }

  isOpen(): boolean {
    return !this.toolbar.hidden || !this.launcher.hidden || !this.editor.hidden || !this.popover.hidden;
  }

  /** The toolbar or the compact icon is showing for a selection. */
  isSelectionUiOpen(): boolean {
    return !this.toolbar.hidden || !this.launcher.hidden;
  }

  /** The note editor or an annotation popover is open (the user is working in it). */
  isEditing(): boolean {
    return !this.editor.hidden || !this.popover.hidden;
  }

  // -- helpers --------------------------------------------------------------

  /** Same controls as the creation toolbar; the current style is shown pressed. */
  private styleRow(a: Annotation): HTMLDivElement {
    const row = document.createElement('div');
    row.className = 'styles';
    const toggle = (b: HTMLButtonElement, on: boolean, change: StyleChange): HTMLButtonElement => {
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
      if (toggleStyle(a.style, change, Boolean(a.note)) === null) {
        b.disabled = true;
        b.title = t('styleKeepOne');
      }
      return b;
    };
    for (const c of COLORS) {
      const b = this.button('', t('toolbarHighlight', t(c.label)), () => this.h.onChangeStyle(a.id, { highlight: c.id }));
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = c.css;
      b.append(dot);
      row.append(toggle(b, a.style.highlight === c.id, { highlight: c.id }));
    }
    row.append(this.sep());
    const u = this.button('U', t('toolbarUnderline'), () => this.h.onChangeStyle(a.id, { underline: true }));
    u.classList.add('u');
    row.append(
      toggle(u, Boolean(a.style.underline), { underline: true }),
      toggle(
        this.button('B', t('toolbarBold'), () => this.h.onChangeStyle(a.id, { bold: true })),
        Boolean(a.style.bold),
        { bold: true },
      ),
    );
    return row;
  }

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

  /** Drag handle, to move the toolbar off the site's own toolbar. */
  private grip(): HTMLSpanElement {
    const grip = document.createElement('span');
    grip.className = 'grip';
    grip.title = t('dragHandle');
    grip.setAttribute('aria-label', t('dragHandle'));
    grip.innerHTML =
      '<svg viewBox="0 0 8 16" aria-hidden="true"><circle cx="2" cy="3" r="1.3"/><circle cx="6" cy="3" r="1.3"/>' +
      '<circle cx="2" cy="8" r="1.3"/><circle cx="6" cy="8" r="1.3"/><circle cx="2" cy="13" r="1.3"/><circle cx="6" cy="13" r="1.3"/></svg>';
    let offset: { x: number; y: number } | null = null;
    grip.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      // Capture keeps the release on the handle, so the page never sees it as a new selection.
      grip.setPointerCapture(e.pointerId);
      const r = this.toolbar.getBoundingClientRect();
      offset = { x: e.clientX - r.left, y: e.clientY - r.top };
    });
    grip.addEventListener('pointermove', (e) => {
      if (!offset) return;
      const { width, height } = this.toolbar.getBoundingClientRect();
      const left = Math.max(0, Math.min(e.clientX - offset.x, window.innerWidth - width));
      const top = Math.max(0, Math.min(e.clientY - offset.y, window.innerHeight - height));
      this.toolbar.style.left = `${Math.round(left)}px`;
      this.toolbar.style.top = `${Math.round(top)}px`;
    });
    const end = (): void => {
      offset = null;
    };
    grip.addEventListener('pointerup', end);
    grip.addEventListener('pointercancel', end);
    return grip;
  }

  private place(el: HTMLElement, rect: DOMRect, placement: ToolbarPlacement = 'above'): void {
    el.hidden = false;
    const { width, height } = el.getBoundingClientRect();
    const margin = 8;
    let top: number;
    if (placement === 'below') {
      top = rect.bottom + margin;
      if (top + height > window.innerHeight - margin) top = rect.top - height - margin;
    } else {
      top = rect.top - height - margin;
      if (top < margin) top = rect.bottom + margin;
    }
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
