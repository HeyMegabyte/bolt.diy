#!/usr/bin/env node
/**
 * Minimal bundler — copies tsc output + static assets to dist/.
 *
 * MV3 modules don't need a real bundler; we just flatten the build/
 * tree into dist/ at the names the manifest expects:
 *   - background/service-worker.js → dist/background.js
 *   - content/content-script.js    → dist/content.js
 *   - popup/popup.js               → dist/popup.js
 *   - options/options.js           → dist/options.js
 */
import { cp, mkdir, copyFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const build = join(root, 'build');
const dist = join(root, 'dist');

await mkdir(dist, { recursive: true });

const map = [
  ['background/service-worker.js', 'background.js'],
  ['content/content-script.js', 'content.js'],
  ['popup/popup.js', 'popup.js'],
  ['options/options.js', 'options.js'],
  ['shared/api.js', 'shared/api.js'],
  ['shared/messages.js', 'shared/messages.js'],
];

for (const [src, target] of map) {
  const srcPath = join(build, src);
  const destPath = join(dist, target);
  if (!existsSync(srcPath)) {
    console.warn('[bundle] missing', srcPath, '(run `npm run build` first)');
    continue;
  }
  await mkdir(dirname(destPath), { recursive: true });
  await copyFile(srcPath, destPath);
}

// Static assets — manifest, popup html/css, options html/css, content css, icons.
const staticCopies = [
  ['manifest.json', 'manifest.json'],
  ['src/popup/popup.html', 'popup.html'],
  ['src/popup/popup.css', 'popup.css'],
  ['src/options/options.html', 'options.html'],
  ['src/options/options.css', 'options.css'],
  ['src/content/content.css', 'content.css'],
];
for (const [src, target] of staticCopies) {
  const srcPath = join(root, src);
  const destPath = join(dist, target);
  await mkdir(dirname(destPath), { recursive: true });
  await copyFile(srcPath, destPath);
}

// Icons dir.
const iconsSrc = join(root, 'icons');
const iconsDest = join(dist, 'icons');
if (existsSync(iconsSrc)) {
  await cp(iconsSrc, iconsDest, { recursive: true });
} else {
  console.warn('[bundle] icons/ missing — see README "Icons" section');
}

// Assets dir (shared brand assets).
const assetsSrc = join(root, 'src/assets');
const assetsDest = join(dist, 'assets');
if (existsSync(assetsSrc)) {
  const files = await readdir(assetsSrc).catch(() => []);
  if (files.length > 0) await cp(assetsSrc, assetsDest, { recursive: true });
}

console.log('[bundle] dist/ ready');
