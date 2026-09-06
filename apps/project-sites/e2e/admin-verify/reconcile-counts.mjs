/**
 * reconcile-counts.mjs — TRUTHFUL-DATA reconciler that needs NO Browserbase.
 *
 * The sibling `reconcile-surfaces.mjs` drives a real browser (the admin API is
 * CF-bot-challenged from headless) and therefore SKIPS whenever Browserbase creds
 * are unset — so on most local/CI runs the truthful-data dimension goes unverified.
 * This probe closes that gap a different way, per `verify-against-source-of-truth`
 * ("reconcile display-vs-STORE, not just render-vs-endpoint" + "build the reconciler
 * as a reusable tool"):
 *
 *   GROUND TRUTH  ← `wrangler d1 execute --remote` COUNT(*) per concept (the store),
 *   DISPLAY       ← the authed admin API via the `*.workers.dev` origin (bypasses the
 *                    Bot-Fight challenge that blocks headless calls to projectsites.dev),
 *   FLAG          → display !== store ⇒ LYING-EMPTY / WRONG-SOURCE (a real bug).
 *
 * Fail-open (conditional-ci-gates): if E2E_API_KEY or CLOUDFLARE_API_KEY is unset it
 * prints a `::notice::` and exits 0 — never a false red on a secret-less run.
 *
 * Run:  E2E_API_KEY=$(get-secret E2E_API_KEY) CLOUDFLARE_API_KEY=$(get-secret CLOUDFLARE_API_KEY) \
 *       CLOUDFLARE_EMAIL=blzalewski@gmail.com node e2e/admin-verify/reconcile-counts.mjs
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const KEY = process.env.E2E_API_KEY;
const CF_KEY = process.env.CLOUDFLARE_API_KEY;
const CF_EMAIL = process.env.CLOUDFLARE_EMAIL || 'blzalewski@gmail.com';
const ORG = process.env.RECONCILE_ORG || 'e2e-test-org'; // the org E2E_API_KEY authenticates as
const API = process.env.RECONCILE_API_BASE || 'https://project-sites.manhattan.workers.dev';
const DB = 'project-sites-db-production';
const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';

if (!KEY || !CF_KEY) {
  console.log('::notice:: reconcile-counts skipped — E2E_API_KEY / CLOUDFLARE_API_KEY unset');
  process.exit(0);
}

/** Read every store count in ONE remote D1 query (org is a trusted constant — safe to inline). */
function groundTruth() {
  const sql = `SELECT
    (SELECT COUNT(*) FROM sites WHERE org_id='${ORG}' AND deleted_at IS NULL) AS sites,
    (SELECT COUNT(*) FROM media_assets WHERE org_id='${ORG}' AND deleted_at IS NULL) AS media,
    (SELECT COUNT(*) FROM ai_env_vars WHERE org_id='${ORG}' AND deleted_at IS NULL) AS env_vars,
    (SELECT COUNT(*) FROM api_tokens WHERE org_id='${ORG}' AND revoked_at IS NULL AND deleted_at IS NULL) AS api_tokens,
    (SELECT COUNT(*) FROM audit_logs WHERE org_id='${ORG}') AS audit_logs;`;
  const r = spawnSync(
    'npx',
    ['wrangler', 'd1', 'execute', DB, '--remote', '--env', 'production', '--json', '--command', sql],
    { cwd: PROJECT_ROOT, encoding: 'utf8', env: { ...process.env, CLOUDFLARE_API_KEY: CF_KEY, CLOUDFLARE_EMAIL: CF_EMAIL }, maxBuffer: 8 << 20 },
  );
  // Parse STDOUT only — wrangler logs a colored WARNING banner (containing `[`) to
  // STDERR; concatenating it would break JSON.parse. `--json` output is clean on stdout.
  const out = r.stdout || '';
  const start = out.indexOf('[');
  if (start < 0) return null;
  try {
    const parsed = JSON.parse(out.slice(start));
    return parsed[0]?.results?.[0] ?? null;
  } catch {
    return null;
  }
}

/** Fetch a display count from the authed admin API (workers.dev bypasses Bot-Fight). */
async function display(path, pick) {
  const res = await fetch(`${API}${path}`, { headers: { authorization: `Bearer ${KEY}`, 'user-agent': UA } });
  if (!res.ok) return { err: `HTTP ${res.status}` };
  const j = await res.json().catch(() => null);
  if (!j) return { err: 'non-JSON' };
  return { n: pick(j) };
}

const store = groundTruth();
if (!store) {
  console.log('::notice:: reconcile-counts skipped — could not read D1 ground truth (wrangler auth?)');
  process.exit(0);
}

// Each surface: the store count + how to read the SAME count off the display API.
const SURFACES = [
  { key: 'sites', path: '/api/sites', pick: (j) => j.total ?? (Array.isArray(j.data) ? j.data.length : NaN) },
  { key: 'media', path: '/api/media/assets', pick: (j) => (Array.isArray(j.assets) ? j.assets.length : NaN) },
  { key: 'env_vars', path: '/api/env-vars', pick: (j) => (Array.isArray(j.vars) ? j.vars.length : NaN) },
  { key: 'api_tokens', path: '/api/v1-tokens', pick: (j) => (Array.isArray(j.data) ? j.data.length : NaN) },
  { key: 'audit_logs', path: '/api/audit-logs', pick: (j) => j.meta?.total ?? NaN },
];

const rows = [];
for (const s of SURFACES) {
  const d = await display(s.path, s.pick);
  const storeN = Number(store[s.key]);
  const displayN = d.err ? d.err : Number(d.n);
  const ok = !d.err && Number.isFinite(displayN) && displayN === storeN;
  rows.push({ key: s.key, store: storeN, display: displayN, ok });
}

const fails = rows.filter((r) => !r.ok);
for (const r of rows) {
  console.log(`  ${r.ok ? '✓' : '✗'} ${r.key.padEnd(11)} store=${r.store}  display=${r.display}${r.ok ? '' : '  ← DIVERGENCE (lying-empty / wrong-source)'}`);
}
console.log(
  fails.length
    ? `VERDICT: ❌ FAIL — ${fails.length}/${rows.length} surface(s) diverge (display ≠ store)`
    : `VERDICT: ✅ PASS — ${rows.length}/${rows.length} surfaces reconcile (display == store)`,
);
process.exit(fails.length ? 1 : 0);
