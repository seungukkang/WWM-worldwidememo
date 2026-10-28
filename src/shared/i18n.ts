/**
 * Thin wrapper over chrome.i18n. Strings live in src/_locales/<lang>/messages.json;
 * `en` is the default locale and the source of truth for keys (typed below).
 * The UI language follows the browser's UI language.
 */
export type MessageKey = keyof typeof import('../_locales/en/messages.json');

export function t(key: MessageKey, ...substitutions: Array<string | number>): string {
  const msg =
    typeof chrome !== 'undefined' && chrome.i18n?.getMessage
      ? chrome.i18n.getMessage(key, substitutions.map(String))
      : '';
  return msg || key;
}

/**
 * BCP-47 tag of the locale actually used for our messages (e.g. "ko", "en-US"),
 * so dates/numbers match the UI strings.
 */
export function uiLanguage(): string {
  if (typeof chrome === 'undefined' || !chrome.i18n) return 'en';
  // `localeCode` is defined in every catalog, so this is the catalog actually in use
  // (@@ui_locale reports the browser locale, which can differ from the chosen catalog).
  return chrome.i18n.getMessage('localeCode') || chrome.i18n.getUILanguage();
}

/**
 * Localize static markup: `data-i18n="key"` sets textContent,
 * `data-i18n-title="key"` sets title and aria-label.
 */
export function localizeDocument(root: ParentNode = document): void {
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n]')) {
    el.textContent = t(el.dataset.i18n as MessageKey);
  }
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n-title]')) {
    const text = t(el.dataset.i18nTitle as MessageKey);
    el.title = text;
    el.setAttribute('aria-label', text);
  }
}
