#!/usr/bin/env node
/**
 * Zips dist/ into projectsites-chrome-extension-vX.Y.Z.zip for Web Store upload.
 *
 * Uses the system zip binary (macOS + Linux). On Windows, install
 * `zip` via WSL or run the equivalent PowerShell command.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const out = join(root, `projectsites-chrome-extension-v${manifest.version}.zip`);

execSync(`cd ${JSON.stringify(join(root, 'dist'))} && zip -r ${JSON.stringify(out)} .`, {
  stdio: 'inherit',
});
console.log(`[package] wrote ${out}`);
