/**
 * Label UI pieces for the side panel: chips, the per-page label menu, the
 * label manager and a small toast. Writes go through background messages.
 * See docs/design/library.md.
 */
import { cycleLabelColor, moveLabel, nextLabelColor } from '../core/library';
import type { Label, LabelColor } from '../core/types';
import { t } from '../shared/i18n';
import { sendToBackground } from '../shared/messages';

export const LABEL_HEX: Record<LabelColor, string> = {
  red: '#e5484d',
  orange: '#f76b15',
  yellow: '#f5c400',
  green: '#30a46c',
  teal: '#12a594',
  blue: '#3e8ef7',
  purple: '#8e4ec6',
  gray: '#8b8d98',
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function labelDot(color: LabelColor): HTMLSpanElement {
  const dot = el('span', 'dot');
  dot.style.background = LABEL_HEX[color];
  return dot;
}

/** A small read-only label tag; with `onRemove`, it gets an × button. */
export function labelTag(label: Label, onRemove?: () => void): HTMLSpanElement {
  const tag = el('span', 'tag');
  tag.append(labelDot(label.color), el('span', undefined, label.name));
  if (onRemove) {
    const x = el('button', 'tag-x', '×');
    x.title = t('labelRemove', label.name);
    x.setAttribute('aria-label', x.title);
    x.addEventListener('click', (e) => {
      e.stopPropagation();
      onRemove();
    });
    tag.append(x);
  }
  return tag;
}

export async function createLabel(name: string, existing: readonly Label[]): Promise<Label> {
  const now = new Date().toISOString();
  const order = existing.reduce((max, l) => Math.max(max, l.order), -1) + 1;
  const label: Label = { id: crypto.randomUUID(), name, color: nextLabelColor(existing), order, createdAt: now, updatedAt: now };
  return (await sendToBackground({ type: 'wwm/label-save', label })).label;
}

export function setPageLabels(pageKey: string, labelIds: string[]): Promise<unknown> {
  return sendToBackground({ type: 'wwm/page-labels', pageKey, labelIds });
}

/** Text input that calls `onSubmit` with a trimmed, non-empty value on Enter. */
function nameInput(placeholder: string, onSubmit: (name: string) => void, onCancel?: () => void): HTMLInputElement {
  const input = el('input', 'label-input');
  input.type = 'text';
  input.maxLength = 40;
  input.placeholder = placeholder;
  input.setAttribute('aria-label', placeholder);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && input.value.trim()) {
      onSubmit(input.value.trim());
      input.value = '';
    } else if (e.key === 'Escape') {
      onCancel?.();
    }
  });
  input.addEventListener('click', (e) => e.stopPropagation());
  return input;
}

/** Checkbox list of labels for one page, plus "new label" (created and applied at once). */
export function labelMenu(pageKey: string, labels: readonly Label[], selected: readonly string[]): HTMLDivElement {
  const menu = el('div', 'label-menu');
  menu.addEventListener('click', (e) => e.stopPropagation());
  const current = new Set(selected);
  for (const label of labels) {
    const row = el('label', 'label-row');
    const box = el('input');
    box.type = 'checkbox';
    box.checked = current.has(label.id);
    box.addEventListener('change', () => {
      if (box.checked) current.add(label.id);
      else current.delete(label.id);
      void setPageLabels(pageKey, [...current]);
    });
    row.append(box, labelDot(label.color), el('span', undefined, label.name));
    menu.append(row);
  }
  menu.append(
    nameInput(t('labelNewPlaceholder'), async (name) => {
      const label = await createLabel(name, labels);
      current.add(label.id);
      await setPageLabels(pageKey, [...current]);
    }),
  );
  return menu;
}

/** Rename, recolor, reorder and delete labels. */
export function labelManager(labels: readonly Label[]): HTMLDivElement {
  const box = el('div', 'manage');
  if (labels.length === 0) box.append(el('p', 'muted', t('labelsEmpty')));
  for (const label of labels) {
    const row = el('div', 'manage-row');
    const color = el('button', 'icon-btn');
    color.title = t('labelColor');
    color.setAttribute('aria-label', t('labelColor'));
    color.append(labelDot(label.color));
    color.addEventListener('click', () => void save({ ...label, color: cycleLabelColor(label.color) }));

    const name = el('input', 'label-input');
    name.value = label.name;
    name.maxLength = 40;
    name.setAttribute('aria-label', t('labelName'));
    name.addEventListener('change', () => {
      const v = name.value.trim();
      if (v && v !== label.name) void save({ ...label, name: v });
      else name.value = label.name;
    });

    const move = (delta: number, text: string, title: string): HTMLButtonElement => {
      const b = el('button', 'icon-btn', text);
      b.title = title;
      b.setAttribute('aria-label', title);
      b.addEventListener('click', () => void sendToBackground({ type: 'wwm/labels-reorder', ids: moveLabel(labels, label.id, delta) }));
      return b;
    };
    const del = el('button', 'icon-btn', '🗑');
    del.title = t('labelDeleteTitle');
    del.setAttribute('aria-label', t('labelDeleteTitle'));
    del.addEventListener('click', async () => {
      await sendToBackground({ type: 'wwm/label-delete', id: label.id });
      showPanelToast(t('labelDeleted', label.name), {
        label: t('undo'),
        run: () => void save(label), // label has no deletedAt: saving it restores it
      });
    });
    row.append(color, name, move(-1, '↑', t('labelUp')), move(1, '↓', t('labelDown')), del);
    box.append(row);
  }
  return box;
}

function save(label: Label): Promise<unknown> {
  return sendToBackground({ type: 'wwm/label-save', label });
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;

/** A brief message at the bottom of the side panel, with an optional action (e.g. Undo). */
export function showPanelToast(message: string, action?: { label: string; run: () => void }): void {
  const toast = document.getElementById('panel-toast');
  if (!toast) return;
  clearTimeout(toastTimer);
  toast.replaceChildren(el('span', undefined, message));
  if (action) {
    const b = el('button', undefined, action.label);
    b.addEventListener('click', () => {
      toast.hidden = true;
      action.run();
    });
    toast.append(b);
  }
  toast.hidden = false;
  toastTimer = setTimeout(() => (toast.hidden = true), 6000);
}
