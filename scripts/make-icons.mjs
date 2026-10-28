#!/usr/bin/env node
/**
 * Render assets/brand/icon.svg → assets/icons/icon-{16,32,48,128}.png.
 * 16px uses the simplified icon-small.svg for legibility.
 * 128px follows the Chrome Web Store guideline: 96×96 artwork + 16px transparent padding.
 * Requires Playwright with Chromium (`npm i -D playwright && npx playwright install chromium`).
 */
import { readFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = await import('playwright');

const full = await readFile(join(root, 'assets/brand/icon.svg'), 'utf8');
const small = await readFile(join(root, 'assets/brand/icon-small.svg'), 'utf8');
await mkdir(join(root, 'assets/icons'), { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage();
for (const size of [16, 32, 48, 128]) {
  const svg = size <= 16 ? small : full;
  await page.setViewportSize({ width: size, height: size });
  const pad = size === 128 ? 16 : 0;
  const art = size - pad * 2;
  await page.setContent(
    `<html><body style="margin:0;background:transparent;padding:${pad}px;line-height:0">` +
      svg.replace('<svg ', `<svg width="${art}" height="${art}" `) +
      `</body></html>`,
  );
  await page.screenshot({ path: join(root, `assets/icons/icon-${size}.png`), omitBackground: true });
  console.log(`icon-${size}.png`);
}
await browser.close();
