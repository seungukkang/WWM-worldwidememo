#!/usr/bin/env node
/**
 * Generate Chrome Web Store assets from the real extension (dist/) running on
 * the demo article in assets/store/demo/:
 *   assets/store/icon-128.png              store icon (96×96 artwork + 16px padding)
 *   assets/store/<lang>/screenshot-1.png   1280×800  page after a site update + popover + side panel
 *   assets/store/<lang>/screenshot-2.png   1280×800  selection toolbar + side panel style bar & settings
 *   assets/store/<lang>/screenshot-3.png   1280×800  the demo article as a PDF in the WWM viewer
 *   assets/store/<lang>/promo-small.png    440×280
 *   assets/store/global/screenshot-*.png   language-independent set (English UI)
 *
 * Usage: npm run build && npm run store-assets      (WWM_STORE_LANG=en|ko for one language)
 * macOS: Chromium ignores --lang and uses the system language. To render the
 *   English set on a Korean system, set the test browser's language first:
 *   defaults write com.google.chrome.for.testing AppleLanguages -array en
 *   (and `defaults delete com.google.chrome.for.testing AppleLanguages` after).
 * Needs: playwright + Chromium (see docs/guides or README "Development").
 */
import { copyFile, mkdtemp, mkdir, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const demoDir = join(root, 'assets', 'store', 'demo');
const { chromium } = await import('playwright');

/** Per-language demo script: which quotes to annotate in v1 and how to style them. */
const PLAN = {
  en: {
    tagline: 'Highlights & notes that survive page updates',
    targets: [
      { quote: 'reversing a gradual noising process', style: { highlight: 'yellow' }, note: 'Core idea — explain this in the seminar.' },
      { quote: 'Gaussian noise is added to an image step by step', style: { highlight: 'green' } },
      { quote: 'A neural network is then trained to predict the noise that was added at each step.', style: { highlight: 'blue' } },
      { quote: 'start from pure noise', style: { underline: true } },
      { quote: 'about a thousand steps', style: { highlight: 'pink' } },
      { quote: 'distillation', style: { bold: true }, note: 'Also read about consistency models.' },
    ],
    clickQuote: 'reversing a gradual noising process',
    selectQuote: 'repeatedly remove the predicted noise',
    pdfTargets: [
      { quote: 'reversing a gradual noising process', style: { highlight: 'yellow' }, note: 'Core idea.' },
      { quote: 'Gaussian noise is added to an image step by step', style: { highlight: 'green' } },
      { quote: 'start from pure noise', style: { underline: true } },
    ],
  },
  ko: {
    tagline: '사이트가 바뀌어도 살아남는 하이라이트와 메모',
    targets: [
      { quote: '거꾸로 되돌리는 방법으로 데이터를 생성한다', style: { highlight: 'yellow' }, note: '핵심 아이디어 — 세미나에서 설명할 것.' },
      { quote: 'Gaussian noise를 한 단계씩 더해', style: { highlight: 'green' } },
      { quote: '그다음 신경망이 각 단계에서 더해진 노이즈를 예측하도록 학습시킨다.', style: { highlight: 'blue' } },
      { quote: '순수한 노이즈에서 출발해', style: { underline: true } },
      { quote: '약 천 번의 단계', style: { highlight: 'pink' } },
      { quote: 'distillation', style: { bold: true }, note: 'consistency model도 같이 읽어볼 것.' },
    ],
    clickQuote: '거꾸로 되돌리는 방법으로 데이터를 생성한다',
    selectQuote: '반복해서 제거한다',
    pdfTargets: [
      { quote: '거꾸로 되돌리는 방법', style: { highlight: 'yellow' }, note: '핵심 아이디어.' },
      { quote: 'Gaussian noise를 한 단계씩 더해', style: { highlight: 'green' } },
      { quote: '순수한 노이즈에서 출발해', style: { underline: true } },
    ],
  },
};

let current = 'en-v1.html';
/** The demo article printed to PDF, per language (screenshot 3). */
const pdfs = {};
const server = createServer(async (req, res) => {
  const pdf = req.url?.match(/^\/papers\/(\w+)\.pdf$/);
  if (pdf) {
    res.writeHead(200, { 'content-type': 'application/pdf' });
    res.end(pdfs[pdf[1]]);
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(await readFile(join(demoDir, current)));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const url = `${origin}/lab-notes/diffusion-intro`;

const printer = await chromium.launch();
for (const lang of Object.keys(PLAN)) {
  const p = await printer.newPage();
  await p.setContent(await readFile(join(demoDir, `${lang}-v1.html`), 'utf8'));
  pdfs[lang] = await p.pdf({ format: 'A4', printBackground: true });
}
await printer.close();

await copyFile(join(root, 'assets', 'icons', 'icon-128.png'), join(root, 'assets', 'store', 'icon-128.png'));

/** Page (920 wide) + side panel (360 wide) side by side, 1280×800. */
async function compose(canvas, pageShot, panelShot, path) {
  await canvas.setViewportSize({ width: 1280, height: 800 });
  await canvas.setContent(
    `<body style="margin:0;display:flex;background:#e7e3da">
       <img src="data:image/png;base64,${pageShot.toString('base64')}" width="920" height="800">
       <img src="data:image/png;base64,${panelShot.toString('base64')}" width="360" height="800"
            style="box-shadow:-1px 0 0 #d6d1c4">
     </body>`,
  );
  await canvas.screenshot({ path });
}

/** Annotate the current selection in the active tab, then set styles/notes in storage. */
async function annotate(page, sw, tabId, targets, select) {
  await page.bringToFront(); // commands go to the active tab
  for (const target of targets) {
    await select(target.quote);
    await sw.evaluate(async (id) => {
      const tab = id ?? (await chrome.tabs.query({ active: true }))[0].id;
      await chrome.tabs.sendMessage(tab, { type: 'wwm/command', command: 'highlight' });
    }, tabId);
    await page.waitForTimeout(250);
  }
  // The toolbar is a closed shadow root: apply the planned styles/notes in storage.
  await sw.evaluate(async (targets) => {
    const all = await chrome.storage.local.get(null);
    for (const [key, rec] of Object.entries(all)) {
      if (!key.startsWith('wwm:page:')) continue;
      for (const a of rec.annotations) {
        const exact = a.target.selectors.find((s) => s.type === 'TextQuoteSelector')?.exact;
        const t = targets.find((x) => x.quote === exact);
        if (!t) continue;
        a.style = t.style;
        if (t.note) a.note = t.note;
      }
      await chrome.storage.local.set({ [key]: rec });
    }
  }, targets);
}

/** Open the side panel page for the tab that is in front, then return its screenshot. */
async function panelShot(context, front, id, before) {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 360, height: 800 });
  await front.bringToFront();
  await panel.goto(`chrome-extension://${id}/sidepanel/index.html`);
  await panel.waitForTimeout(700);
  if (before) await before(panel);
  const shot = await panel.screenshot();
  await panel.close();
  return shot;
}

async function selectQuote(page, quote) {
  await page.evaluate((q) => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const i = n.data.indexOf(q);
      if (i === -1) continue;
      const r = document.createRange();
      r.setStart(n, i);
      r.setEnd(n, i + q.length);
      getSelection().removeAllRanges();
      getSelection().addRange(r);
      return;
    }
    throw new Error(`quote not found: ${q}`);
  }, quote);
}

async function quoteRect(page, quote) {
  return page.evaluate((q) => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const i = n.data.indexOf(q);
      if (i === -1) continue;
      const r = document.createRange();
      r.setStart(n, i);
      r.setEnd(n, i + q.length);
      const b = r.getClientRects()[0];
      return { x: b.x + 6, y: b.y + b.height / 2 };
    }
    return null;
  }, quote);
}

const only = process.env.WWM_STORE_LANG;
for (const [lang, plan] of Object.entries(PLAN)) {
  if (only && lang !== only) continue;
  const outDir = join(root, 'assets', 'store', lang);
  await mkdir(outDir, { recursive: true });
  current = `${lang}-v1.html`;

  const context = await chromium.launchPersistentContext(await mkdtemp(join(tmpdir(), 'wwm-store-')), {
    channel: 'chromium',
    headless: true,
    locale: lang,
    viewport: { width: 920, height: 800 },
    deviceScaleFactor: 1,
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`, `--lang=${lang}`],
  });
  const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const page = await context.newPage();
  await page.goto(url);
  await page.waitForTimeout(500);

  const id = new URL(sw.url()).host;
  const canvas = await context.newPage();

  // Screenshot 1: annotate v1, then the site gets updated (one sentence
  // rewritten, one paragraph removed); open an annotation's popover.
  await annotate(page, sw, undefined, plan.targets, (q) => selectQuote(page, q));
  current = `${lang}-v2.html`;
  await page.reload();
  await page.waitForTimeout(900);
  const pos = await quoteRect(page, plan.clickQuote);
  if (pos) await page.mouse.click(pos.x, pos.y);
  await page.waitForTimeout(300);
  await compose(canvas, await page.screenshot(), await panelShot(context, page, id), join(outDir, 'screenshot-1.png'));

  // Screenshot 2: the selection toolbar (with its drag handle) and the side
  // panel's style bar and toolbar settings.
  await page.bringToFront();
  await page.keyboard.press('Escape');
  await selectQuote(page, plan.selectQuote);
  await page.evaluate(() => document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })));
  await page.waitForTimeout(300);
  const toolbarShot = await page.screenshot();
  await compose(
    canvas,
    toolbarShot,
    await panelShot(context, page, id, (panel) => panel.click('#settings-toggle')),
    join(outDir, 'screenshot-2.png'),
  );

  // Screenshot 3: the same article as a PDF in the WWM viewer.
  await page.goto(`chrome-extension://${id}/pdf/viewer.html?file=${encodeURIComponent(`${origin}/papers/${lang}.pdf`)}`);
  await page.waitForSelector('.textLayer span', { timeout: 15000 });
  await page.waitForTimeout(500);
  const viewerTab = await page.evaluate(async () => (await chrome.tabs.getCurrent()).id);
  await annotate(page, sw, viewerTab, plan.pdfTargets, (q) =>
    page.evaluate((quote) => {
      const walker = document.createTreeWalker(document.getElementById('pages'), NodeFilter.SHOW_TEXT);
      const nodes = [];
      let text = '';
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        nodes.push([n, text.length]);
        text += n.data;
      }
      const i = text.indexOf(quote);
      if (i < 0) throw new Error(`quote not in PDF: ${quote}`);
      const at = (o) => nodes.findLast(([, s]) => s <= o);
      const [sn, so] = at(i);
      const [en, eo] = at(i + quote.length);
      const r = document.createRange();
      r.setStart(sn, i - so);
      r.setEnd(en, i + quote.length - eo);
      getSelection().removeAllRanges();
      getSelection().addRange(r);
    }, q),
  );
  await page.evaluate(() => getSelection().removeAllRanges());
  await page.reload();
  await page.waitForSelector('.textLayer span');
  await page.waitForTimeout(1200);
  await compose(canvas, await page.screenshot(), await panelShot(context, page, id), join(outDir, 'screenshot-3.png'));

  const logo = await readFile(join(root, 'assets', 'brand', 'icon.svg'), 'utf8');
  await canvas.setViewportSize({ width: 440, height: 280 });
  await canvas.setContent(
    `<body style="margin:0;width:440px;height:280px;background:#1f1b2e;color:#f4f1ea;display:flex;flex-direction:column;
       justify-content:center;align-items:center;gap:14px;font-family:-apple-system,'Segoe UI','Apple SD Gothic Neo','Noto Sans KR',sans-serif">
       ${logo.replace('<svg ', '<svg width="88" height="88" ')}
       <div style="font-size:30px;font-weight:800;letter-spacing:.5px">WWM <span style="font-weight:500;opacity:.8">WorldWideMemo</span></div>
       <div style="font-size:16px;background:#ffd600;color:#1f1b2e;padding:3px 10px;border-radius:6px;font-weight:600">${plan.tagline}</div>
     </body>`,
  );
  await canvas.screenshot({ path: join(outDir, 'promo-small.png') });

  await context.close();
  console.log(`[wwm] store assets → ${outDir}`);
}

// Language-independent screenshots: the English set.
if (only && only !== 'en') {
  server.close();
  process.exit(0);
}
const globalDir = join(root, 'assets', 'store', 'global');
await mkdir(globalDir, { recursive: true });
for (const n of [1, 2, 3]) {
  await copyFile(join(root, 'assets', 'store', 'en', `screenshot-${n}.png`), join(globalDir, `screenshot-${n}.png`));
}
console.log(`[wwm] global screenshots → ${globalDir}`);
server.close();
