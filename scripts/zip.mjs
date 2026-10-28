#!/usr/bin/env node
/** Package dist/ into release/wwm-<version>.zip for the Chrome Web Store. Requires the `zip` CLI. */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
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
// `zip` updates an existing archive in place, which would keep files deleted from dist/.
rmSync(out, { force: true });
execFileSync('zip', ['-r', '-X', out, '.'], { cwd: dist, stdio: 'inherit' });
console.log(`[wwm] packaged → ${out}`);
