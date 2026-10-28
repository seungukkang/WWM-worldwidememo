#!/usr/bin/env node
/**
 * End-to-end smoke test: loads dist/ into Chromium and checks
 *   1. a highlight can be created on a page and is persisted,
 *   2. CSS.highlights is populated (isolated world → page registry),
 *   3. it is restored after reload,
 *   4. after the page changes (v1 → v2 at the same URL) it is re-anchored.
 *
 *   5. the UI language follows the browser locale (WWM_LANG=en|ko).
 *   6. PDFs: a prompt is shown over Chrome's PDF viewer; the WWM viewer renders a text
 *      layer that can be annotated; annotations persist and the PDF auto-opens next time.
 *   6b. editing: the popover changes an annotation's style; delete can be undone;
 *       the side panel's undo/redo restores an overwritten note.
 *   7. PDF viewer basics: zoom keeps annotations, links (internal + Back, web, mailto),
 *      page number, outline, download, print.
 *
 * Usage:  npm run build && npm run e2e          (WWM_LANG=ko npm run e2e for Korean)
 * Needs:  playwright + Chromium (`npm i -D playwright && npx playwright install chromium`).
 *         Uses full Chromium in new-headless mode (headless-shell cannot load extensions).
 */
import { mkdtemp, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dist = join(root, 'dist');
const fixtures = join(root, 'tests', 'fixtures', 'pages');
const { chromium } = await import('playwright');
const lang = process.env.WWM_LANG ?? 'en';
const loadCatalog = async (l) => JSON.parse(await readFile(join(root, 'src', '_locales', l, 'messages.json'), 'utf8'));

// A PDF of the v1 article, printed by plain Chromium (no extension).
const printer = await chromium.launch();
const printPage = await printer.newPage();
await printPage.setContent(await readFile(join(fixtures, 'article-v1.html'), 'utf8'));
const pdfBytes = await printPage.pdf({ format: 'A4' });
// A two-page PDF with an internal link (to page 2), a web link and a mailto: link.
await printPage.setContent(`<h1>Intro</h1><p><a href="#refs">See references</a> ·
  <a href="https://example.com/">example.com</a> · <a href="mailto:author@example.com">author@example.com</a></p>
  <h1 id="refs" style="break-before: page">References</h1><p>[1] A reference.</p>`);
const linksPdfBytes = await printPage.pdf({ format: 'A4', outline: true, tagged: true }); // outline needs tagged
await printer.close();

// Serve one URL whose content we can swap between versions.
let version = 'article-v1.html';
const server = createServer(async (req, res) => {
  if (req.url?.startsWith('/paper.pdf') || req.url?.startsWith('/links.pdf')) {
    res.writeHead(200, { 'content-type': 'application/pdf' });
    res.end(req.url.startsWith('/paper') ? pdfBytes : linksPdfBytes);
  } else if (req.url?.startsWith('/article')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(await readFile(join(fixtures, version)));
  } else {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const url = `${origin}/article`;

/**
 * Click a button inside WWM's closed shadow root. Page scripts cannot reach it,
 * so locate it through the DevTools protocol (pierce) and click with the mouse.
 */
async function clickInShadow(page, selector, index = 0) {
  const cdp = await page.context().newCDPSession(page);
  try {
    const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
    const find = (n) => (n.localName === 'wwm-root' ? n : (n.children ?? []).map(find).find(Boolean));
    const host = find(root);
    const shadow = host?.shadowRoots?.[0];
    if (!shadow) throw new Error('WWM shadow root not found');
    const { nodeIds } = await cdp.send('DOM.querySelectorAll', { nodeId: shadow.nodeId, selector });
    const nodeId = index < 0 ? nodeIds.at(index) : nodeIds[index];
    if (!nodeId) throw new Error(`no element for ${selector} [${index}]`);
    const { model } = await cdp.send('DOM.getBoxModel', { nodeId });
    const [x1, y1, , , x3, y3] = model.content;
    await page.mouse.click((x1 + x3) / 2, (y1 + y3) / 2);
  } finally {
    await cdp.detach();
  }
}

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const context = await chromium.launchPersistentContext(await mkdtemp(join(tmpdir(), 'wwm-e2e-')), {
  channel: 'chromium',
  headless: true,
  locale: lang,
  args: [
    `--disable-extensions-except=${dist}`,
    `--load-extension=${dist}`,
    `--lang=${lang}`,
  ],
});

try {
  const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  check('service worker started', Boolean(sw), sw.url());

  const i18n = await sw.evaluate(() => ({
    ui: chrome.i18n.getUILanguage(),
    menu: chrome.i18n.getMessage('menuHighlight'),
  }));
  // macOS Chrome ignores --lang and follows the system language, so verify against the locale actually in use.
  const uiLang = i18n.ui.startsWith('ko') ? 'ko' : 'en';
  if (uiLang !== lang) console.log(`WARN  requested ${lang} but browser UI is ${i18n.ui} (system language); checking ${uiLang}`);
  const catalog = await loadCatalog(uiLang);
  check(`UI strings localized (${uiLang})`, i18n.menu === catalog.menuHighlight.message, `ui=${i18n.ui}, "${i18n.menu}"`);

  const page = await context.newPage();
  await page.goto(url);
  await page.waitForTimeout(500);

  // Select a sentence in the page (selection is shared across JS worlds) and let the
  // content script pick it up, then trigger the "highlight" command via the background.
  const quote = 'Sampling is slow because it requires hundreds of network evaluations.';
  await page.evaluate((q) => {
    const p = [...document.querySelectorAll('p')].find((el) => el.textContent.includes(q));
    const t = p.firstChild;
    const i = t.data.indexOf(q);
    const r = document.createRange();
    r.setStart(t, i);
    r.setEnd(t, i + q.length);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
  }, quote);
  await sw.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true });
    await chrome.tabs.sendMessage(tab.id, { type: 'wwm/command', command: 'highlight' });
  });
  await page.waitForTimeout(400);

  const stored = await sw.evaluate(() => chrome.storage.local.get(null));
  const pageRecords = Object.entries(stored).filter(([k]) => k.startsWith('wwm:page:'));
  const annotations = pageRecords.flatMap(([, v]) => v.annotations);
  check('annotation persisted', annotations.length === 1, `${annotations.length} stored`);
  check(
    'quote selector stored',
    annotations[0]?.target.selectors.some((s) => s.type === 'TextQuoteSelector' && s.exact === quote),
  );

  const registry = () =>
    page.evaluate(() => ({
      supported: typeof CSS !== 'undefined' && 'highlights' in CSS,
      yellow: CSS.highlights?.get('wwm-hl-yellow')?.size ?? -1,
    }));
  let reg = await registry();
  check(
    'CSS.highlights visible from page world (Spike S1)',
    reg.yellow === 1,
    `supported=${reg.supported}, wwm-hl-yellow size=${reg.yellow}`,
  );

  await page.reload();
  await page.waitForTimeout(700);
  reg = await registry();
  check('restored after reload', reg.yellow === 1, `size=${reg.yellow}`);

  version = 'article-v2.html';
  await page.reload();
  await page.waitForTimeout(700);
  reg = await registry();
  const after = await sw.evaluate(() => chrome.storage.local.get(null));
  const a2 = Object.entries(after)
    .filter(([k]) => k.startsWith('wwm:page:'))
    .flatMap(([, v]) => v.annotations)[0];
  check(
    're-anchored on changed page (v2)',
    reg.yellow === 1 && a2?.anchor?.status === 'anchored',
    `size=${reg.yellow}, status=${a2?.anchor?.status}/${a2?.anchor?.method}`,
  );

  // ---- editing ---------------------------------------------------------------
  const layerSizes = () =>
    page.evaluate(() => ({
      yellow: CSS.highlights.get('wwm-hl-yellow')?.size ?? -1,
      blue: CSS.highlights.get('wwm-hl-blue')?.size ?? -1,
    }));
  const clickAnnotation = async () => {
    const at = await page.evaluate(() => {
      const range = [...CSS.highlights.get('wwm-hl-yellow'), ...CSS.highlights.get('wwm-hl-blue')][0];
      const r = range.getClientRects()[0];
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    await page.mouse.click(at.x, at.y);
    await page.waitForTimeout(200);
  };
  const storedAnnotation = async () =>
    (await sw.evaluate(() => chrome.storage.local.get(null)))[`wwm:page:${url}`]?.annotations[0];

  await clickAnnotation();
  await clickInShadow(page, '[data-name="popover"] .styles button', 2); // blue
  await page.waitForTimeout(300);
  let sizes = await layerSizes();
  check(
    'popover changes the highlight color',
    sizes.blue === 1 && sizes.yellow === 0 && (await storedAnnotation())?.style.highlight === 'blue',
    JSON.stringify(sizes),
  );
  await page.reload();
  await page.waitForTimeout(700);
  check('changed color persists after reload', (await layerSizes()).blue === 1);

  await clickAnnotation();
  await clickInShadow(page, '[data-name="popover"] .row button', -1); // Delete
  await page.waitForTimeout(300);
  const deleted = (await layerSizes()).blue === 0 && Boolean((await storedAnnotation())?.deletedAt);
  await clickInShadow(page, '[data-name="toast"] button'); // Undo
  await page.waitForTimeout(300);
  const restored = await storedAnnotation();
  check(
    'delete can be undone',
    deleted && (await layerSizes()).blue === 1 && restored && !restored.deletedAt,
    `deleted=${deleted}, restored deletedAt=${restored?.deletedAt}`,
  );

  // Undo/redo from the side panel (opened as a tab; same messages as the panel buttons).
  const extId = new URL(sw.url()).host;
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extId}/sidepanel/index.html`);
  const panelStep = (type) =>
    panel.evaluate(
      async ({ type, pageKey, origin }) => {
        const res = await chrome.runtime.sendMessage({ type, pageKey });
        const [tab] = await chrome.tabs.query({ url: `${origin}/*` });
        await chrome.tabs.sendMessage(tab.id, { type: 'wwm/refresh' });
        return res.ok;
      },
      { type, pageKey: url, origin },
    );
  const writeNote = async (text) => {
    await page.bringToFront();
    await clickAnnotation();
    await clickInShadow(page, '[data-name="popover"] .row button', -2); // Add / Edit note
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type(text);
    await page.keyboard.press('ControlOrMeta+Enter');
    await page.waitForTimeout(300);
  };
  await writeNote('first thought');
  await writeNote('rewritten');
  const noteBefore = (await storedAnnotation())?.note;
  const undone = await panelStep('wwm/undo');
  await page.waitForTimeout(300);
  const noteUndone = (await storedAnnotation())?.note;
  const redone = await panelStep('wwm/redo');
  await page.waitForTimeout(300);
  check(
    'side panel undo restores an overwritten note, redo reapplies',
    noteBefore === 'rewritten' && undone && noteUndone === 'first thought' && redone && (await storedAnnotation())?.note === 'rewritten',
    `${noteBefore} → ${noteUndone} → ${(await storedAnnotation())?.note}`,
  );
  await panel.close();

  // ---- PDF -----------------------------------------------------------------
  const pdfUrl = `${origin}/paper.pdf`;
  await page.goto(pdfUrl);
  await page.waitForTimeout(1500);
  check('PDF prompt over Chrome viewer', await page.evaluate(() => Boolean(document.querySelector('wwm-root'))));

  await page.goto(`chrome-extension://${extId}/pdf/viewer.html?file=${encodeURIComponent(pdfUrl)}`);
  await page.waitForSelector('.textLayer span', { timeout: 15000 });
  await page.waitForTimeout(500);
  const pdfQuote = 'Sampling is slow because it requires hundreds';
  const selected = await page.evaluate((q) => {
    // The quote spans several text-layer <span>s: map flat offsets back to nodes.
    const walker = document.createTreeWalker(document.getElementById('pages'), NodeFilter.SHOW_TEXT);
    const nodes = [];
    let text = '';
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      nodes.push([n, text.length]);
      text += n.data;
    }
    const at = (off) => nodes.findLast(([, s]) => s <= off);
    const i = text.indexOf(q);
    if (i < 0) return '';
    const [sn, so] = at(i);
    const [en, eo] = at(i + q.length);
    const r = document.createRange();
    r.setStart(sn, i - so);
    r.setEnd(en, i + q.length - eo);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
    return getSelection().toString();
  }, pdfQuote);
  await sw.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true });
    await chrome.tabs.sendMessage(tab.id, { type: 'wwm/command', command: 'highlight' });
  });
  await page.waitForTimeout(400);
  const pdfKeys = Object.keys(await sw.evaluate(() => chrome.storage.local.get(null))).filter((k) =>
    k.startsWith('wwm:page:pdf:'),
  );
  const pdfYellow = () => page.evaluate(() => CSS.highlights.get('wwm-hl-yellow')?.size ?? -1);
  check(
    'PDF annotated in WWM viewer',
    selected === pdfQuote && pdfKeys.length === 1 && (await pdfYellow()) === 1,
    `selected="${selected}", keys=${pdfKeys.length}`,
  );

  await page.reload();
  await page.waitForSelector('.textLayer span');
  await page.waitForTimeout(800);
  check('PDF annotation restored after reload', (await pdfYellow()) === 1);

  const hlWidth = () =>
    page.evaluate(() => [...CSS.highlights.get('wwm-hl-yellow')][0]?.getBoundingClientRect().width ?? 0);
  const widthBefore = await hlWidth();
  await page.click('#zoom-in');
  await page.waitForTimeout(400);
  const widthAfter = await hlWidth();
  check(
    'PDF zoom keeps the annotation attached',
    (await pdfYellow()) === 1 && widthAfter > widthBefore * 1.05,
    `width ${Math.round(widthBefore)} → ${Math.round(widthAfter)}, ${await page.textContent('#zoom-level')}`,
  );

  await page.goto(pdfUrl);
  await page.waitForURL(/^chrome-extension:\/\//, { timeout: 5000 }).catch(() => undefined);
  check('annotated PDF auto-opens in WWM viewer', page.url().startsWith(`chrome-extension://${extId}/pdf/`));

  await page.goto(`chrome-extension://${extId}/pdf/viewer.html?file=${encodeURIComponent(`${origin}/links.pdf`)}`);
  await page.waitForSelector('.textLayer span', { timeout: 15000 });
  await page.waitForTimeout(300);
  const links = await page.evaluate(() =>
    [...document.querySelectorAll('.linkAnnotation > a')].map((a) => ({ href: a.getAttribute('href'), target: a.target })),
  );
  check(
    'PDF links: web (new tab), mailto, internal',
    links.some((l) => l.href === 'https://example.com/' && l.target === '_blank') &&
      links.some((l) => l.href === 'mailto:author@example.com') &&
      links.some((l) => l.href === '#'),
    JSON.stringify(links),
  );
  const internal = page.locator('.linkAnnotation > a[href="#"]').first();
  await internal.click();
  await page.waitForTimeout(300);
  const landed = await page.evaluate(() => {
    const p2 = document.querySelector('.page[data-page="2"]').getBoundingClientRect();
    return p2.top < window.innerHeight / 2 && p2.bottom > 0;
  });
  check('PDF internal link scrolls to its destination', landed && (await page.inputValue('#page-input')) === '2');
  await page.evaluate(() => history.back());
  await page.waitForTimeout(300);
  check('PDF Back returns to the link', (await page.inputValue('#page-input')) === '1');

  await page.click('#outline-toggle');
  const outline = await page.locator('#outline .title').allTextContents();
  check('PDF outline listed', outline.includes('References'), JSON.stringify(outline));

  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 5000 }).catch(() => null), page.click('#download')]);
  check('PDF download', download?.suggestedFilename() === 'links.pdf', download?.suggestedFilename() ?? 'none');

  await page.evaluate(() => {
    window.print = () => (window.__printedPages = document.querySelectorAll('#print-pages img').length);
  });
  await page.click('#print');
  await page.waitForFunction(() => window.__printedPages !== undefined, null, { timeout: 15000 }).catch(() => undefined);
  check('PDF print renders every page', (await page.evaluate(() => window.__printedPages)) === 2);

  await page.screenshot({ path: join(tmpdir(), 'wwm-e2e.png') });
  console.log(`screenshot: ${join(tmpdir(), 'wwm-e2e.png')}`);
} finally {
  await context.close();
  server.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
