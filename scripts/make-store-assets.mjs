#!/usr/bin/env node
/**
 * Generate Chrome Web Store assets from the real extension (dist/) running on
 * the demo article in assets/store/demo/:
 *   assets/store/<lang>/screenshot-1.png   1280×800  (page + side panel, after a site update)
 *   assets/store/<lang>/promo-small.png    440×280
 *
 * Usage: npm run build && npm run store-assets
 * Needs: playwright + Chromium (see docs/guides or README "Development").
 */
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
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
  },
};

let current = 'en-v1.html';
const server = createServer(async (req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(await readFile(join(demoDir, current)));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/lab-notes/diffusion-intro`;

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

for (const [lang, plan] of Object.entries(PLAN)) {
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

  // 1) Annotate v1 through the real content script (command → selection → upsert).
  for (const target of plan.targets) {
    await selectQuote(page, target.quote);
    await sw.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true });
      await chrome.tabs.sendMessage(tab.id, { type: 'wwm/command', command: 'highlight' });
    });
    await page.waitForTimeout(250);
  }

  // 2) Apply the planned styles/notes directly in storage (the toolbar is a closed shadow root).
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
  }, plan.targets);

  // 3) The site gets updated: one sentence rewritten, one paragraph removed.
  current = `${lang}-v2.html`;
  await page.reload();
  await page.waitForTimeout(900);
  const pos = await quoteRect(page, plan.clickQuote);
  if (pos) await page.mouse.click(pos.x, pos.y);
  await page.waitForTimeout(300);
  const pageShot = await page.screenshot();

  // 4) Side panel for the same tab.
  const id = new URL(sw.url()).host;
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 360, height: 800 });
  await page.bringToFront();
  await panel.goto(`chrome-extension://${id}/sidepanel/index.html`);
  await panel.waitForTimeout(700);
  const panelShot = await panel.screenshot();

  // 5) Compose 1280×800 and the promo tile.
  const canvas = await context.newPage();
  await canvas.setViewportSize({ width: 1280, height: 800 });
  await canvas.setContent(
    `<body style="margin:0;display:flex;background:#e7e3da">
       <img src="data:image/png;base64,${pageShot.toString('base64')}" width="920" height="800">
       <img src="data:image/png;base64,${panelShot.toString('base64')}" width="360" height="800"
            style="box-shadow:-1px 0 0 #d6d1c4">
     </body>`,
  );
  await canvas.screenshot({ path: join(outDir, 'screenshot-1.png') });

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
server.close();
