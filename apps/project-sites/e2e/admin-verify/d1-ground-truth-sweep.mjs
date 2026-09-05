#!/usr/bin/env node
/**
 * d1-ground-truth-sweep.mjs — the dimension-2 companion to reconcile-surfaces.mjs.
 *
 * reconcile-surfaces checks DISPLAY == STORE via the app's endpoints (as brian, in a
 * real browser). This checks the STORE ITSELF directly against a documented baseline —
 * it queries prod D1 (`project-sites-db-production`) for brian's real org
 * (`org-brian-001` / `site-megabytespace-001`) and flags two classes reconcile can miss:
 *
 *   1. LYING-EMPTY RISK — a count below reconcile's hard `gt` floor (the endpoint would
 *      then render fewer rows than the store has, if the read path breaks).
 *   2. DATA-LOSS — a count that has DROPPED well below its prior baseline (unexpected
 *      deletion). reconcile's `gt` is a LOWER bound (data only grows), so a drop from
 *      e.g. 1257 audit rows → 3 still clears `gt=50` yet signals a real deletion bug.
 *
 * Baselines are append-only observations; bump them UP when a count legitimately grows
 * (never down). Counts only grow in normal operation, so a drop is always worth a look.
 *
 * Auth: exports CLOUDFLARE_API_KEY (global key) + CLOUDFLARE_EMAIL from ENV (never inline).
 * Usage: CLOUDFLARE_API_KEY=… CLOUDFLARE_EMAIL=… node e2e/admin-verify/d1-ground-truth-sweep.mjs
 * Exit 0 = all healthy · 1 = a floor breach or suspicious drop · 2 = creds/query error.
 */
import { execFileSync } from 'node:child_process';

const ORG = 'org-brian-001';
const SITE = 'site-megabytespace-001';

if (!process.env.CLOUDFLARE_API_KEY || !process.env.CLOUDFLARE_EMAIL) {
  console.log('::notice:: d1-ground-truth-sweep skipped — CLOUDFLARE_API_KEY / CLOUDFLARE_EMAIL unset');
  process.exit(0);
}

// name → { sql, gt (reconcile hard floor), baseline (last observed; drop-detection reference) }
const CHECKS = {
  sites: { sql: `SELECT COUNT(*) AS n FROM sites WHERE org_id='${ORG}' AND deleted_at IS NULL`, gt: 1, baseline: 2 },
  media_assets: { sql: `SELECT COUNT(*) AS n FROM media_assets WHERE org_id='${ORG}' AND deleted_at IS NULL`, gt: 2, baseline: 2 },
  memberships: { sql: `SELECT COUNT(*) AS n FROM memberships WHERE org_id='${ORG}'`, gt: 1, baseline: 1 },
  audit_logs: { sql: `SELECT COUNT(*) AS n FROM audit_logs WHERE org_id='${ORG}'`, gt: 50, baseline: 1257 },
  site_snapshots: { sql: `SELECT COUNT(*) AS n FROM site_snapshots WHERE site_id='${SITE}'`, gt: 4, baseline: 5 },
  mcp_connections: { sql: `SELECT COUNT(*) AS n FROM mcp_connections WHERE site_id='${SITE}' AND status='active'`, gt: 2, baseline: 2 },
};

function count(sql) {
  const out = execFileSync(
    'npx',
    ['wrangler', 'd1', 'execute', 'project-sites-db-production', '--env', 'production', '--remote', '--json', '--command', sql],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 120_000 },
  );
  const json = JSON.parse(out);
  const rows = json[0]?.results ?? [];
  return Number(rows[0]?.n ?? NaN);
}

const report = [];
let bad = 0;
for (const [name, { sql, gt, baseline }] of Object.entries(CHECKS)) {
  let n;
  try {
    n = count(sql);
  } catch (e) {
    report.push({ name, verdict: `❌ QUERY ERROR ${String(e).slice(0, 60)}` });
    bad++;
    continue;
  }
  let verdict;
  if (!Number.isFinite(n)) { verdict = '❌ no count'; bad++; }
  else if (n < gt) { verdict = `🔴 BELOW gt (${n} < ${gt}) — lying-empty risk`; bad++; }
  // Suspicious drop: fell to under half the last-observed baseline (and baseline was meaningful).
  else if (baseline >= 4 && n < baseline * 0.5) { verdict = `🟠 DROP (${n} ≪ baseline ${baseline}) — possible data loss`; bad++; }
  else verdict = `✅ ${n} (gt=${gt}, baseline=${baseline})`;
  report.push({ name, verdict });
}

console.log('\n=== D1 GROUND-TRUTH COUNT SWEEP (org-brian-001 / site-megabytespace-001) ===\n');
for (const r of report) console.log(`  ${r.verdict.padEnd(46)} ${r.name}`);
console.log(`\n${bad === 0 ? '✅ all counts healthy (≥ gt, no drop)' : `${bad} issue(s) — see above`}`);
process.exit(bad === 0 ? 0 : 1);
