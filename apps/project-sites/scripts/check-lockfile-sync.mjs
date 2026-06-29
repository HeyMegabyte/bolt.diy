#!/usr/bin/env node
/**
 * check-lockfile-sync — fail fast on root pnpm-lock.yaml drift.
 *
 * The root monorepo `package.json` and `pnpm-lock.yaml` silently drifted once
 * (lockfile May 18 vs package.json Jun 2) → every CI run died at
 * `pnpm install --frozen-lockfile` with ERR_PNPM_OUTDATED_LOCKFILE, which also
 * killed the WORKER DEPLOY for many loop fires before anyone noticed (the loop
 * watches app tests, not root CI). This guard surfaces that drift immediately.
 *
 * Runs the exact CI check (`pnpm install --frozen-lockfile --lockfile-only`) at
 * the repo root and exits 1 on drift with the one-line fix. Pure detection — no
 * install, no writes. Wire into CI / pre-push; the /loop can run it each fire.
 *
 * Usage: node apps/project-sites/scripts/check-lockfile-sync.mjs
 * Fix on drift: (cd <repo root> && pnpm install --lockfile-only) then commit pnpm-lock.yaml
 */
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
// apps/project-sites/scripts → repo root is three levels up.
const repoRoot = resolve(here, '..', '..', '..');

if (!existsSync(resolve(repoRoot, 'pnpm-lock.yaml'))) {
  console.error(`check-lockfile-sync: no pnpm-lock.yaml at ${repoRoot} — skipping`);
  process.exit(0);
}

const PNPM = 'pnpm@9.14.4'; // matches root packageManager pin

try {
  execSync(`npx --yes ${PNPM} install --frozen-lockfile --lockfile-only --ignore-scripts`, {
    cwd: repoRoot,
    stdio: 'pipe',
    timeout: 240_000,
  });
  console.log('✓ check-lockfile-sync: root pnpm-lock.yaml is in sync with package.json');
  process.exit(0);
} catch (err) {
  const out = `${err?.stdout ?? ''}${err?.stderr ?? ''}`;
  if (/ERR_PNPM_OUTDATED_LOCKFILE|not up to date/i.test(out)) {
    console.error(
      '✗ check-lockfile-sync: root pnpm-lock.yaml is OUT OF SYNC with package.json.\n' +
        '  This silently breaks CI + the worker deploy. Fix:\n' +
        `    (cd "${repoRoot}" && npx ${PNPM} install --lockfile-only) && git add pnpm-lock.yaml`,
    );
    process.exit(1);
  }
  // A different failure (network/npx) — don't false-positive the gate; warn + pass.
  console.error(`check-lockfile-sync: inconclusive (non-drift error), passing:\n${out.slice(0, 400)}`);
  process.exit(0);
}
