#!/usr/bin/env node
/** Package dist/ into release/wwm-<version>.zip for the Chrome Web Store. Requires the `zip` CLI. */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
if (!existsSync(join(dist, 'manifest.json'))) {
  console.error('dist/ not found. Run `node scripts/build.mjs --prod` first.');
  process.exit(1);
}
const { version } = JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8'));
mkdirSync(join(root, 'release'), { recursive: true });
const out = join(root, 'release', `wwm-${version}.zip`);
execFileSync('zip', ['-r', '-X', out, '.'], { cwd: dist, stdio: 'inherit' });
console.log(`[wwm] packaged → ${out}`);
