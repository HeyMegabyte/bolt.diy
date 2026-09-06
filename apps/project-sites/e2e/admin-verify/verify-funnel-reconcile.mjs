#!/usr/bin/env node
/**
 * verify-funnel-reconcile.mjs — reconcile the super-admin Activation Funnel
 * DISPLAY against the D1 STORE (published sites). Guards the exact class that
 * slipped EVERY existing probe across the AL-050 / AL-051 arc:
 *
 *   - AL-050: `outbox_events` table missing in prod → 0 events ever reached
 *     Tinybird → funnel Delivered honestly showed 0 while D1 had 106 published
 *     (lying-empty at the source; masked because 0==0 passes every render/reconcile
 *     gate — nothing distinguishes honestly-empty from lying-empty without ground truth).
 *   - AL-051: `fetchActivationFunnel` used last-tenant-wins over the pipe's
 *     GROUP-BY-tenant_id rows → the GLOBAL funnel collapsed to ONE tenant's count
 *     (Delivered read 2 while Tinybird held 106) — wrong-source at the display layer.
 *
 * Both are display≠store bugs that a self-referential "does the UI match its own
 * endpoint" check can never catch. Per verify-against-source-of-truth, this queries
 * the AUTHORITATIVE STORE directly (D1) and diffs it against what the funnel shows.
 *
 * What it does:
 *   1. GROUND TRUTH — `wrangler d1 execute` COUNT(DISTINCT id) of published sites
 *      (all tenants; the funnel is global). This is the store the Delivered stage
 *      MUST reflect.
 *   2. DISPLAY — auth as brian (super-admin; the funnel is super-admin-gated, so
 *      E2E_API_KEY=e2e-test-org can't see it) → GET /api/admin/activation-funnel?days=365
 *      → Delivered.sites + degraded.
 *   3. RECONCILE — Delivered.sites must be within [0.8 * groundTruth, ∞) AND
 *      degraded must be false. `display << store` (0 or a single tenant's count) is
 *      the lying-empty / wrong-source signal → FAIL.
 *   Plus a cross-window monotonicity sanity (365d ≥ 30d ≥ 7d) AND an outbox-health
 *   check: 0 DEAD-LETTERED rows (a stuck `failed`/attempts>=5 row means a REQUIRED
 *   target — Tinybird — is failing, or the AL-050 best-effort-Hatchet fix regressed;
 *   the pipeline that FEEDS this funnel is unhealthy). AL-053 requeued the last
 *   pre-AL-050 false-failure (Hatchet-only dead-letter whose Tinybird ingest succeeded).
 *
 * Auth path uses workers.dev (project-sites.manhattan.workers.dev) so the
 * super-admin test-login + admin API dodge the prod-domain bot challenge (same
 * pattern as prod-verify-authed-mutation). Skips (exit 0) when
 * E2E_TEST_PASSWORD or CLOUDFLARE_API_KEY is unset so forks + secret-less CI stay green.
 *
 * Usage: E2E_TEST_PASSWORD=$(get-secret E2E_TEST_PASSWORD) \
 *        CLOUDFLARE_API_KEY=$(get-secret CLOUDFLARE_API_KEY) CLOUDFLARE_EMAIL=blzalewski@gmail.com \
 *        node e2e/admin-verify/verify-funnel-reconcile.mjs
 */
import { execSync } from 'node:child_process';

const PW = process.env.E2E_TEST_PASSWORD;
const CF_KEY = process.env.CLOUDFLARE_API_KEY;
if (!PW || !CF_KEY) {
  console.log('::notice:: verify-funnel-reconcile skipped — E2E_TEST_PASSWORD / CLOUDFLARE_API_KEY unset');
  process.exit(0);
}

const BASE = process.env.PROD_URL || 'https://project-sites.manhattan.workers.dev';
const DB = process.env.PROD_D1 || 'project-sites-db-production';
const ADMIN_EMAIL = process.env.FUNNEL_ADMIN_EMAIL || 'brian@megabyte.space';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';
const H = { 'User-Agent': UA, Origin: 'https://projectsites.dev' };

/** Parse `wrangler d1 execute --json` output (leading warnings + possible trailing content). */
function parseWranglerJson(raw) {
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start < 0 || end < 0) throw new Error('no JSON array in wrangler output');
  return JSON.parse(raw.slice(start, end + 1));
}

/** D1 ground truth: distinct published sites across ALL tenants (the funnel is global). */
function groundTruthPublished() {
  const cmd =
    `npx wrangler d1 execute ${DB} --remote --env production --json ` +
    `--command "SELECT COUNT(DISTINCT id) c FROM sites WHERE status='published' AND deleted_at IS NULL;"`;
  const raw = execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const arr = parseWranglerJson(raw);
  return Number(arr[0]?.results?.[0]?.c ?? 0);
}

/** D1 outbox health: count of DEAD-LETTERED rows (status=failed, attempts>=MAX_OUTBOX_ATTEMPTS=5).
 *  A stuck dead-letter means a REQUIRED target (Tinybird) is failing, OR the AL-050
 *  best-effort-Hatchet fix regressed (a Hatchet-only failure re-dead-lettering a row
 *  whose Tinybird ingest succeeded). Either is a pipeline-health alarm feeding the funnel. */
function groundTruthDeadLetters() {
  const cmd =
    `npx wrangler d1 execute ${DB} --remote --env production --json ` +
    `--command "SELECT COUNT(*) c FROM outbox_events WHERE status='failed' AND attempts>=5;"`;
  const raw = execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const arr = parseWranglerJson(raw);
  return Number(arr[0]?.results?.[0]?.c ?? 0);
}

/** Delivered.sites for a given window (global). */
function deliveredSites(funnel) {
  const s = (funnel?.stages ?? []).find((x) => x.stage === 'site.published');
  return Number(s?.sites ?? 0);
}

async function getFunnel(token, days) {
  const res = await fetch(`${BASE}/api/admin/activation-funnel?days=${days}`, {
    headers: { ...H, Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`funnel display ${res.status} (not super-admin / not authed?)`);
  return res.json();
}

try {
  // 1) DISPLAY — super-admin session
  const loginRes = await fetch(`${BASE}/api/auth/test-login`, {
    method: 'POST',
    headers: { ...H, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: PW }),
  });
  const loginBody = await loginRes.json().catch(() => ({}));
  const token = loginBody?.data?.token ?? '';
  if (!token) {
    console.log(`::notice:: verify-funnel-reconcile skipped — test-login for ${ADMIN_EMAIL} returned no token (${loginRes.status})`);
    process.exit(0);
  }

  const f365 = await getFunnel(token, 365);
  const f30 = await getFunnel(token, 30);
  const f7 = await getFunnel(token, 7);
  const display = deliveredSites(f365);
  const degraded = f365?.degraded !== false;

  // 2) GROUND TRUTH
  const store = groundTruthPublished();
  const deadLetters = groundTruthDeadLetters();

  // 3) RECONCILE
  const floor = Math.floor(store * 0.8);
  const notEmpty = display > 0 || store === 0;
  const reconciles = display >= floor; // display must reflect the store, not 0 / one-tenant
  const monotonic = deliveredSites(f365) >= deliveredSites(f30) && deliveredSites(f30) >= deliveredSites(f7);
  const outboxHealthy = deadLetters === 0; // a stuck dead-letter = required-target failure / AL-050 regression
  const ok = !degraded && notEmpty && reconciles && monotonic && outboxHealthy;

  console.log('\n=== ACTIVATION FUNNEL: display vs D1 store (+ outbox pipeline health) ===');
  console.log(`  D1 published (store, all tenants): ${store}`);
  console.log(`  funnel Delivered.sites (display, 365d): ${display}  (30d=${deliveredSites(f30)} 7d=${deliveredSites(f7)})`);
  console.log(`  degraded: ${f365?.degraded}   outbox dead-letters: ${deadLetters}`);
  console.log(
    `\nVERDICT: ${ok ? '✅ PASS' : '🔴 CHECK'} — display ${display} vs store ${store} ` +
      `(floor ${floor}); degraded=${f365?.degraded}; monotonic=${monotonic}; deadLetters=${deadLetters}`,
  );
  if (!ok && !reconciles) {
    console.log(
      '   ↳ Delivered << published-site count → LYING-EMPTY / WRONG-SOURCE. Either the outbox→Tinybird ' +
        'pipeline is broken (no events) or the global funnel collapsed to one tenant (last-wins). ' +
        'See AL-050 (missing outbox_events table) + AL-051 (per-tenant sum).',
    );
  }
  if (!ok && !outboxHealthy) {
    console.log(
      `   ↳ ${deadLetters} outbox row(s) DEAD-LETTERED (status=failed, attempts>=5) → a REQUIRED target ` +
        '(Tinybird) is failing OR the AL-050 best-effort-Hatchet fix regressed. Inspect: ' +
        "SELECT type,last_error FROM outbox_events WHERE status='failed'.",
    );
  }
  process.exit(ok ? 0 : 1);
} catch (err) {
  console.log(`\n🔴 ERROR: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
}
