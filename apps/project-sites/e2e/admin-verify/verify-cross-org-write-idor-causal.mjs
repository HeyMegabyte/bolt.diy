#!/usr/bin/env node
/**
 * verify-cross-org-write-idor-causal.mjs — CAUSAL cross-org authorization probe for the
 * site-scoped WRITE/compute POST endpoints the READ probe (verify-cross-org-idor-causal.mjs)
 * can't reach.
 *
 * Companion to the READ IDOR probe: that one GETs every `/api/sites/:id/*` read as a foreign
 * org and asserts 404. This one POSTs to the site-scoped COMPUTE endpoints that live inline in
 * `src/index.ts` — `/dashboard/metric`, `/social/proposals`, `/social/engagement`,
 * `/automation/validate` — which historically checked only the feature FLAG (siteId as flag-eval
 * scope) and never the site's org-ownership, so a foreign siteId with the flag on ran site-scoped
 * compute for a site the caller doesn't own. AL-176 fixed the 3 READ leaks + 2 adjacent writes;
 * AL-177 added `assertSiteOwned()` to these 3 remaining compute writes. This probe locks that in.
 *
 * SAFE-BY-DESIGN — every endpoint here is COMPUTE-ONLY (returns a computed result from the request
 * body; no DB row is created/updated by siteId), and we send an EMPTY body, so a request NEVER
 * mutates state on the foreign OR the own site. (Real mutating writes — annotations POST,
 * env-vars, snapshots, api-tokens — are covered by their own verify-*-causal.mjs write→read→delete
 * probes; this file deliberately only exercises the non-mutating compute writes.)
 *
 * Classification per endpoint (authed as the E2E org):
 *   • own === 404      → the feature flag is OFF for the test org → SKIP (vacuous; can't test authz)
 *   • foreign === 404  → ownership enforced ✓ (a foreign site is indistinguishable from a missing one)
 *   • foreign !== 404 while reachable → 🔴 the endpoint ran for a site the caller doesn't own (IDOR)
 *
 * Fail-open (conditional-ci-gates): skips (exit 0) when E2E_API_KEY / CLOUDFLARE_API_KEY is unset or
 * a foreign+own id pair can't be resolved. Auto-joins run-all.mjs via the verify-*-causal.mjs glob.
 *
 * Run:  E2E_API_KEY=$(get-secret E2E_API_KEY) CLOUDFLARE_API_KEY=$(get-secret CLOUDFLARE_API_KEY) \
 *       CLOUDFLARE_EMAIL=blzalewski@gmail.com node e2e/admin-verify/verify-cross-org-write-idor-causal.mjs
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { resolveSecret } from './_browserbase-creds.mjs';

const KEY = resolveSecret('E2E_API_KEY');
const CF_KEY = resolveSecret('CLOUDFLARE_API_KEY');
const CF_EMAIL = resolveSecret('CLOUDFLARE_EMAIL') || 'blzalewski@gmail.com';
const ORG = process.env.RECONCILE_ORG || 'e2e-test-org';
const API = process.env.RECONCILE_API_BASE || 'https://project-sites.manhattan.workers.dev';
const DB = 'project-sites-db-production';
const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';

if (!KEY || !CF_KEY) {
  console.log('::notice:: verify-cross-org-write-idor skipped — E2E_API_KEY / CLOUDFLARE_API_KEY unset');
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
  console.log('::notice:: verify-cross-org-write-idor skipped — could not resolve a foreign + own site id (wrangler auth?)');
  process.exit(0);
}

// Site-scoped COMPUTE POST endpoints — empty body, never mutating. suf appended to /api/sites/:id.
const ENDPOINTS = ['/dashboard/metric', '/social/proposals', '/social/engagement', '/automation/validate'];
const H = {
  authorization: `Bearer ${KEY}`,
  'user-agent': UA,
  'content-type': 'application/json',
  Origin: 'https://projectsites.dev',
};

async function code(id, suf) {
  try {
    const res = await fetch(`${API}/api/sites/${id}${suf}`, { method: 'POST', headers: H, body: '{}' });
    return res.status;
  } catch {
    return 0;
  }
}

const rows = [];
for (const suf of ENDPOINTS) {
  const f = await code(FOREIGN, suf);
  const o = await code(OWN, suf);
  // own 404 → flag off for the test org → vacuous, skip. Else foreign MUST be 404.
  const flagOff = o === 404;
  const ok = flagOff || f === 404;
  rows.push({ suf, f, o, ok, flagOff, leak: !flagOff && f !== 404 });
}

const fails = rows.filter((r) => !r.ok);
for (const r of rows) {
  let note = '';
  if (r.flagOff) note = ' (flag off for test org → skipped)';
  else if (r.leak) note = ` ← 🔴 IDOR: foreign=${r.f} (ran site-scoped compute for a non-owned site)`;
  const mark = r.flagOff ? '⚠️ ' : r.ok ? '✓' : '✗';
  console.log(`  ${mark} POST /api/sites/:id${r.suf.padEnd(22)} foreign=${r.f} own=${r.o}${note}`);
}

const tested = rows.filter((r) => !r.flagOff).length;
const skipped = rows.filter((r) => r.flagOff).length;
if (fails.length) {
  console.log(
    `\nVERDICT: ❌ FAIL — ${fails.length}/${tested} site-scoped compute write(s) run for a non-owned site (cross-org IDOR).`,
  );
  process.exit(1);
}
console.log(
  `\nVERDICT: ✅ PASS — ${tested}/${ENDPOINTS.length} site-scoped compute writes enforce org-ownership (foreign→404); ${skipped} skipped (flag off).`,
);
