#!/usr/bin/env node
/**
 * Upload sourcemaps to Sentry for the current deploy (item #48).
 *
 * Usage:
 *   GIT_SHA=$(git rev-parse --short HEAD) \
 *   SENTRY_AUTH_TOKEN=sntrys_... \
 *     node scripts/upload-sentry-sourcemaps.mjs
 *
 * The release name MUST match the value set as `SENTRY_RELEASE` in the
 * deployed Worker (wrangler.toml or `wrangler deploy --var`), otherwise
 * Sentry will not resolve stack frames against the uploaded maps.
 *
 * Provision the auth token:
 *   https://megabyte-labs.sentry.io/settings/auth-tokens/
 * Scopes required: `project:read`, `project:releases`, `org:read`.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');
const distDir = resolve(projectRoot, 'dist');

const ORG = 'megabyte-labs';
const PROJECT = 'project-sites';

const release =
  process.env.SENTRY_RELEASE ||
  process.env.GIT_SHA ||
  (() => {
    const r = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' });
    return r.status === 0 ? r.stdout.trim() : null;
  })() ||
  (() => {
    // Last-resort fallback so the script never throws when run outside a git
    // checkout — uses 8 random hex chars (matches the SENTRY_RELEASE pattern).
    return [...crypto.getRandomValues(new Uint8Array(4))]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  })();

const token = process.env.SENTRY_AUTH_TOKEN;
if (!token) {
  console.warn(
    JSON.stringify({
      level: 'warn',
      service: 'upload-sentry-sourcemaps',
      message: 'SENTRY_AUTH_TOKEN not set — skipping sourcemap upload',
      hint: 'Provision a token at https://megabyte-labs.sentry.io/settings/auth-tokens/',
    }),
  );
  process.exit(0);
}

if (!existsSync(distDir)) {
  console.warn(
    JSON.stringify({
      level: 'warn',
      service: 'upload-sentry-sourcemaps',
      message: `dist/ not found at ${distDir} — skipping. Run 'wrangler deploy' first.`,
    }),
  );
  process.exit(0);
}

/**
 * Run `@sentry/cli` as a subprocess. Resolves to true if exit code is 0.
 *
 * @param {string[]} args
 * @returns {boolean}
 */
function runSentryCli(args) {
  console.warn(
    JSON.stringify({
      level: 'info',
      service: 'upload-sentry-sourcemaps',
      message: `sentry-cli ${args.join(' ')}`,
    }),
  );
  const r = spawnSync('npx', ['--yes', '@sentry/cli', ...args], {
    cwd: projectRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      SENTRY_AUTH_TOKEN: token,
      SENTRY_ORG: ORG,
      SENTRY_PROJECT: PROJECT,
    },
  });
  return r.status === 0;
}

const steps = [
  ['releases', 'new', release],
  ['releases', 'files', release, 'upload-sourcemaps', distDir, '--ext', 'js', '--ext', 'map'],
  ['releases', 'finalize', release],
];

let ok = true;
for (const args of steps) {
  if (!runSentryCli(args)) {
    ok = false;
    break;
  }
}

if (!ok) {
  console.warn(
    JSON.stringify({
      level: 'error',
      service: 'upload-sentry-sourcemaps',
      message: 'Sourcemap upload failed — see sentry-cli output above',
      release,
    }),
  );
  // Soft-fail: don't break the deploy pipeline if Sentry is down.
  process.exit(0);
}

console.warn(
  JSON.stringify({
    level: 'info',
    service: 'upload-sentry-sourcemaps',
    message: 'Sourcemaps uploaded',
    release,
    org: ORG,
    project: PROJECT,
  }),
);
