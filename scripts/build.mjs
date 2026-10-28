#!/usr/bin/env node
/**
 * Build the extension into dist/.
 *   node scripts/build.mjs           # one-shot build (minified=false, sourcemaps inline)
 *   node scripts/build.mjs --watch   # rebuild on change
 *   node scripts/build.mjs --prod    # minified, no sourcemaps
 */
import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const watch = process.argv.includes('--watch');
const prod = process.argv.includes('--prod');

/** Static files copied verbatim: [from (relative to root), to (relative to dist)] */
const STATIC = [
  ['src/manifest.json', 'manifest.json'],
  ['src/content/content.css', 'content.css'],
  ['src/sidepanel/index.html', 'sidepanel/index.html'],
  ['src/sidepanel/sidepanel.css', 'sidepanel/sidepanel.css'],
  ['assets/icons', 'icons'],
  ['src/_locales', '_locales'],
];

async function copyStatic() {
  for (const [from, to] of STATIC) {
    const dest = join(dist, to);
    await mkdir(dirname(dest), { recursive: true });
    await cp(join(root, from), dest, { recursive: true });
  }
}

const common = {
  bundle: true,
  target: 'chrome116',
  sourcemap: prod ? false : 'inline',
  minify: prod,
  logLevel: 'info',
  legalComments: 'none',
};

const entries = [
  { entryPoints: [join(root, 'src/background/service-worker.ts')], outfile: join(dist, 'background.js'), format: 'esm' },
  // Content scripts are classic scripts: bundle as IIFE.
  { entryPoints: [join(root, 'src/content/index.ts')], outfile: join(dist, 'content.js'), format: 'iife' },
  { entryPoints: [join(root, 'src/sidepanel/sidepanel.ts')], outfile: join(dist, 'sidepanel/sidepanel.js'), format: 'esm' },
];

const copyPlugin = {
  name: 'copy-static',
  setup(build) {
    build.onEnd(async (result) => {
      if (result.errors.length === 0) await copyStatic();
    });
  },
};

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

if (watch) {
  const contexts = await Promise.all(
    entries.map((e, i) => esbuild.context({ ...common, ...e, plugins: i === 0 ? [copyPlugin] : [] })),
  );
  await Promise.all(contexts.map((c) => c.watch()));
  console.log('[wwm] watching… (static files are re-copied on background rebuild; restart for manifest changes)');
} else {
  await Promise.all(entries.map((e) => esbuild.build({ ...common, ...e })));
  await copyStatic();
  console.log(`[wwm] built → ${dist}`);
}
