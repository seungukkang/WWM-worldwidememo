#!/usr/bin/env node
/**
 * End-to-end smoke test: loads dist/ into Chromium and checks
 *   1. a highlight can be created on a page and is persisted,
 *   2. CSS.highlights is populated (isolated world → page registry),
 *   3. it is restored after reload,
 *   4. after the page changes (v1 → v2 at the same URL) it is re-anchored.
 *
 *   5. the UI language follows the browser locale (WWM_LANG=en|ko).
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

// Serve one URL whose content we can swap between versions.
let version = 'article-v1.html';
const server = createServer(async (req, res) => {
  if (req.url?.startsWith('/article')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(await readFile(join(fixtures, version)));
  } else {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/article`;

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

  await page.screenshot({ path: join(tmpdir(), 'wwm-e2e.png') });
  console.log(`screenshot: ${join(tmpdir(), 'wwm-e2e.png')}`);
} finally {
  await context.close();
  server.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
