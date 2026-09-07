#!/usr/bin/env node
/**
 * verify-cross-org-idor-causal.mjs — CAUSAL object-level authorization (IDOR) probe.
 *
 * Static analysis can't PROVE a live endpoint enforces org-ownership: a handler that
 * forgets `requireOwnedSite()` returns 200 with ANOTHER org's data, and every
 * render/reconcile gate stays green (the response is well-formed — it's just the wrong
 * org's). This probe attacks the property directly. Authenticated as the E2E org, it
 * requests a site id owned by a DIFFERENT org across every `/api/sites/:id/*` READ
 * endpoint and asserts 404 — never 200 (cross-org DATA leak), never 403 (existence
 * leak; the canonical guard collapses forbidden→404 so a foreign id is indistinguishable
 * from a missing one). A POSITIVE CONTROL (the caller's OWN site) must NOT 404, so a
 * blanket-404 regression can't silently pass the negative test.
 *
 * Guards the shipped IDOR classes: `publish-endpoint-body-slug-write-idor` +
 * `x-org-id-idor-class` (per verify-against-source-of-truth — reconcile the AUTHZ
 * boundary on prod, not just render-vs-endpoint). READ-ONLY — never mutates the foreign
 * resource. Auto-joins `run-all.mjs` via the `verify-*-causal.mjs` glob.
 *
 * Fail-open (conditional-ci-gates): skips (exit 0) when E2E_API_KEY / CLOUDFLARE_API_KEY
 * is unset, or when a foreign+own id pair can't be resolved — forks + secret-less CI stay green.
 *
 * Run:  E2E_API_KEY=$(get-secret E2E_API_KEY) CLOUDFLARE_API_KEY=$(get-secret CLOUDFLARE_API_KEY) \
 *       CLOUDFLARE_EMAIL=blzalewski@gmail.com node e2e/admin-verify/verify-cross-org-idor-causal.mjs
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { resolveSecret } from './_browserbase-creds.mjs';

const KEY = resolveSecret('E2E_API_KEY');
const CF_KEY = resolveSecret('CLOUDFLARE_API_KEY');
const CF_EMAIL = resolveSecret('CLOUDFLARE_EMAIL') || 'blzalewski@gmail.com';
const ORG = process.env.RECONCILE_ORG || 'e2e-test-org'; // the org E2E_API_KEY authenticates as
const API = process.env.RECONCILE_API_BASE || 'https://project-sites.manhattan.workers.dev';
const DB = 'project-sites-db-production';
const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';

if (!KEY || !CF_KEY) {
  console.log('::notice:: verify-cross-org-idor skipped — E2E_API_KEY / CLOUDFLARE_API_KEY unset');
  process.exit(0);
}

/** Run ONE remote D1 query and return its results array (ORG is a trusted constant). */
function d1(sql) {
  const r = spawnSync(
    'npx',
    ['wrangler', 'd1', 'execute', DB, '--remote', '--env', 'production', '--json', '--command', sql],
    { cwd: PROJECT_ROOT, encoding: 'utf8', env: { ...process.env, CLOUDFLARE_API_KEY: CF_KEY, CLOUDFLARE_EMAIL: CF_EMAIL }, maxBuffer: 8 << 20 },
  );
  const out = r.stdout || '';
  const start = out.indexOf('[');
  if (start < 0) return null;
  try {
    return JSON.parse(out.slice(start))[0]?.results ?? null;
  } catch {
    return null;
  }
}

const foreign = d1(
  `SELECT id FROM sites WHERE org_id!='${ORG}' AND deleted_at IS NULL AND status='published' ORDER BY created_at DESC LIMIT 1;`,
);
const own = d1(`SELECT id FROM sites WHERE org_id='${ORG}' AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1;`);
const FOREIGN = foreign?.[0]?.id;
const OWN = own?.[0]?.id;
if (!FOREIGN || !OWN) {
  console.log('::notice:: verify-cross-org-idor skipped — could not resolve a foreign + own site id (wrangler auth?)');
  process.exit(0);
}

// Every /api/sites/:id/* READ endpoint that must be gated by requireOwnedSite().
const SUFFIXES = ['', '/workflow', '/logs', '/analytics', '/forms', '/snapshots', '/readiness', '/hostnames'];
const H = { authorization: `Bearer ${KEY}`, 'user-agent': UA, Origin: 'https://projectsites.dev' };

async function code(id, suf) {
  try {
    const res = await fetch(`${API}/api/sites/${id}${suf}`, { headers: H });
    return res.status;
  } catch {
    return 0;
  }
}

const rows = [];
for (const suf of SUFFIXES) {
  const f = await code(FOREIGN, suf);
  const o = await code(OWN, suf);
  // foreign MUST be 404 (200 = data leak, 403 = existence leak); own MUST NOT be 404 (control).
  const ok = f === 404 && o !== 404;
  rows.push({ suf: suf || '/(root)', f, o, ok, leak: f === 200, existLeak: f === 403, controlBroken: o === 404 });
}

const fails = rows.filter((r) => !r.ok);
for (const r of rows) {
  let note = '';
  if (r.leak) note = ' ← 🔴 IDOR: foreign 200 (cross-org DATA LEAK)';
  else if (r.existLeak) note = ' ← ⚠️ foreign 403 (existence leak; canonical guard wants 404)';
  else if (r.controlBroken) note = ' ← positive control broke (own 404 — negative test vacuous)';
  console.log(`  ${r.ok ? '✓' : '✗'} /api/sites/:id${r.suf.padEnd(11)} foreign=${r.f} own=${r.o}${note}`);
}
console.log(
  fails.length
    ? `VERDICT: ❌ FAIL — ${fails.length}/${rows.length} endpoint(s) fail cross-org authz (see notes)`
    : `VERDICT: ✅ PASS — ${rows.length}/${rows.length} endpoints enforce org-ownership (foreign→404, own→reachable)`,
);
process.exit(fails.length ? 1 : 0);
