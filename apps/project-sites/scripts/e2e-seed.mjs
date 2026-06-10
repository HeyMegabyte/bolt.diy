#!/usr/bin/env node
/**
 * e2e-seed.mjs — idempotently seed the `brian@megabyte.space` owner account the
 * Playwright E2E suite signs in as, by calling the secret-gated test-login seam.
 *
 * The seam (`POST /api/auth/test-login`, see `authenticateTestLogin`) upserts the
 * user + org + owner membership + paid subscription and mints a real session, so
 * running this once primes D1 and proves the seam is live. It is safe to re-run.
 *
 * Auth: the seam is OFF (returns 404) unless the worker has `E2E_TEST_PASSWORD`
 * set (`wrangler secret put E2E_TEST_PASSWORD`). This script needs the same value
 * in its env to authenticate.
 *
 * Usage:
 *   E2E_TEST_PASSWORD=… node scripts/e2e-seed.mjs            # against prod
 *   PROD_URL=http://localhost:8787 E2E_TEST_PASSWORD=… node scripts/e2e-seed.mjs
 *
 * Exit codes: 0 = seeded (session minted) · 1 = misconfig/auth/seam-off · 2 = usage.
 */

const BASE = (process.env.PROD_URL || process.env.BASE_URL || 'https://projectsites.dev').replace(
  /\/+$/,
  '',
);
const EMAIL = 'brian@megabyte.space';
const PASSWORD = process.env.E2E_TEST_PASSWORD;

// Realistic browser signature so Cloudflare Bot Management does not 403 the call
// (per fetch-defaults). Mirrors the current Chrome stable major.
const REAL_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';

function fail(code, msg) {
  console.error(`✘ e2e-seed: ${msg}`);
  process.exit(code);
}

if (!PASSWORD) {
  fail(
    1,
    'E2E_TEST_PASSWORD is not set. Provision it (`wrangler secret put E2E_TEST_PASSWORD`) and export the same value here.',
  );
}

const url = `${BASE}/api/auth/test-login`;
console.warn(`→ seeding ${EMAIL} via ${url}`);

let res;
try {
  res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': REAL_UA,
      Accept: 'application/json',
    },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
} catch (err) {
  fail(1, `request to ${url} failed: ${err.message}`);
}

if (res.status === 404) {
  fail(
    1,
    'seam returned 404 — the worker has no E2E_TEST_PASSWORD secret, so the test-login endpoint is disabled. Set it + redeploy, then re-run.',
  );
}
if (res.status === 401) {
  fail(1, 'seam returned 401 — the E2E_TEST_PASSWORD here does not match the worker secret.');
}
if (!res.ok) {
  const body = await res.text().catch(() => '');
  fail(1, `seam returned HTTP ${res.status}. ${body.slice(0, 200)}`);
}

const json = await res.json().catch(() => ({}));
const data = json?.data ?? {};
if (!data.token || !data.user_id) {
  fail(1, `unexpected response shape: ${JSON.stringify(json).slice(0, 200)}`);
}

console.warn(
  `✓ seeded ${data.email} — org ${data.org_id}, user ${data.user_id}. Session minted (token hidden).`,
);
process.exit(0);
