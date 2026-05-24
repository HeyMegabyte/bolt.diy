#!/usr/bin/env node
/**
 * @file scripts/upload-sourcemaps.mjs
 * @description
 * Uploads the production source maps in `dist/project-sites-frontend/browser`
 * to Sentry so stack traces in the Sentry dashboard show readable function
 * names + file:line:col instead of minified `kqA.prototype.handleError`.
 *
 * Usage
 * -----
 *
 * ```bash
 * # One-time operator setup
 * export SENTRY_AUTH_TOKEN=sntrys_…           # https://sentry.io/settings/account/api/auth-tokens/
 * export SENTRY_ORG=megabyte-labs              # match the slug in the Sentry URL
 * export SENTRY_PROJECT=project-sites-frontend
 *
 * # Every release
 * npm run build:prod
 * npm run upload-sourcemaps                    # idempotent — re-runs are safe
 * ```
 *
 * If `SENTRY_AUTH_TOKEN` is missing the script EXITS SUCCESSFULLY with a
 * one-line `info` log so CI without the secret doesn't fail the build.
 */
import { execSync, spawnSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const AUTH_TOKEN = process.env.SENTRY_AUTH_TOKEN ?? '';
const ORG = process.env.SENTRY_ORG ?? 'megabyte-labs';
const PROJECT = process.env.SENTRY_PROJECT ?? 'project-sites-frontend';
const DIST = join(import.meta.dirname, '..', 'dist', 'project-sites-frontend', 'browser');
const PKG = join(import.meta.dirname, '..', 'package.json');

if (!AUTH_TOKEN) {
  console.warn('[sentry] SENTRY_AUTH_TOKEN not set — skipping source-map upload (this is safe in dev).');
  process.exit(0);
}

if (!existsSync(DIST)) {
  console.error(`[sentry] dist not found at ${DIST}. Run \`npm run build:prod\` first.`);
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(PKG, 'utf8'));
let gitSha = 'unknown';
try {
  gitSha = execSync('git rev-parse --short HEAD').toString().trim();
} catch {
  // Fine in CI without a checked-out git tree.
}

const release = `${pkg.name ?? 'project-sites-frontend'}@${pkg.version ?? '0.0.0'}+${gitSha}`;

console.warn(`[sentry] uploading source maps for release ${release}`);

const run = (args) => {
  const res = spawnSync('npx', ['--yes', '@sentry/cli', ...args], {
    stdio: 'inherit',
    env: {
      ...process.env,
      SENTRY_AUTH_TOKEN: AUTH_TOKEN,
      SENTRY_ORG: ORG,
      SENTRY_PROJECT: PROJECT,
    },
  });
  if (res.status !== 0) {
    console.error(`[sentry] ${args[0]} failed`);
    process.exit(res.status ?? 1);
  }
};

// Idempotent — creating an existing release is a no-op.
run(['releases', 'new', release]);
run([
  'sourcemaps',
  'upload',
  '--release',
  release,
  '--url-prefix',
  '~/',
  DIST,
]);
run(['releases', 'finalize', release]);

console.warn(`[sentry] source maps uploaded for ${release}`);
