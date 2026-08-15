#!/usr/bin/env node
/**
 * reconcile-surfaces.mjs — the LYING-EMPTY / WRONG-SOURCE detector.
 *
 * How the analytics "never had any traffic" bug slipped past ~30 render-integrity
 * verification fires: every prior check proved "the UI renders what its endpoint
 * returns, with 0 console errors" — but NEVER "the endpoint returns what the
 * AUTHORITATIVE STORE actually contains." A page showing an empty state passes
 * every render check yet is WRONG when real records exist in a different store.
 *
 * This harness closes that gap. For every admin surface that displays stored data,
 * it compares the DISPLAY endpoint's output (fetched AS brian, in a real browser so
 * CF Bot Management doesn't 403 the call) against the D1 GROUND-TRUTH count for
 * brian's account (measured separately via `wrangler d1 execute`). A divergence
 * where ground-truth > 0 but the endpoint returns 0/empty is a LYING-EMPTY bug.
 *
 * Ground truth (org-brian-001 / site-megabytespace-001, measured 2026-08-06):
 *   sites 1 · visitor_events 109pv · analytics_daily 9 · media_assets 2 ·
 *   site_snapshots 4 · audit_logs 1129 · voice_numbers 1 · mcp_connections 2 ·
 *   api_tokens 1 · (form_submissions/leads/social/subscriptions/app_instances = 0 = honest-empty)
 *
 * Creds (get-secret): BROWSERBASE_API_KEY, BROWSERBASE_PROJECT_ID, E2E_TEST_PASSWORD.
 * Exits 0 (skip) if any unset. Usage: node e2e/admin-verify/reconcile-surfaces.mjs
 */
import { chromium } from '@playwright/test';

const BB = process.env.BROWSERBASE_API_KEY;
const PROJ = process.env.BROWSERBASE_PROJECT_ID;
const PW = process.env.E2E_TEST_PASSWORD;
if (!BB || !PROJ || !PW) {
  console.log('::notice:: reconcile-surfaces skipped — BROWSERBASE_API_KEY / BROWSERBASE_PROJECT_ID / E2E_TEST_PASSWORD unset');
  process.exit(0);
}

const SITE = 'site-megabytespace-001';

// Each surface: the DISPLAY endpoint the admin UI actually calls, the D1 ground-truth
// count for brian, and how to pull the displayed count from the JSON envelope.
// `extract` returns a number (rows displayed) from the parsed response body.
// `mode: 'populated'` — for WINDOWED / SUBSET surfaces whose exact count legitimately
// drifts (a hardcoded gt goes stale → recurring FALSE 🟠 PARTIALs that erode the
// finder's trust, per validator-precision-discipline). Verify populated (display > 0),
// NOT an exact count. The all-time total is reconciled by its own stable surface.
// Confirmed 2026-08-08 vs live D1: per-site /analytics `pageviews` is a WINDOWED metric
// (D1 visitor_events all-time=131, the endpoint shows the window); per-site logs is
// TARGET_ID-scoped (D1 audit_logs target_id=site = 22, endpoint correctly returns all 22
// — the old gt=200 was stale). Both were false PARTIALs, not product bugs.
const SURFACES = [
  { name: 'sites', endpoint: '/api/sites', gt: 1, extract: (d) => arr(d, 'data', 'sites').length },
  { name: 'analytics (CORRECT /sites/:id/analytics)', endpoint: `/api/sites/${SITE}/analytics`, gt: 1, mode: 'populated', extract: (d) => num(d?.traffic ?? d, 'pageviews') },
  // Read the ACTUAL headline metric the overview shows (`data.total_requests`), not a
  // walk-the-whole-object Math.max (which grabbed a garbage 104B timestamp/id and made
  // this surface's check meaningless — it "passed" on a number the UI never displays).
  // The envelope is `{ data: { total_requests, page_views, ... } }`, so unwrap `.data`.
  { name: 'analytics (UI overview source)', endpoint: '/api/network-analytics', gt: 1, mode: 'populated', extract: (d) => num(d?.data ?? d, 'total_requests') },
  { name: 'media', endpoint: '/api/media/assets', gt: 2, extract: (d) => arr(d, 'data', 'assets', 'items').length },
  { name: 'snapshots', endpoint: `/api/sites/${SITE}/snapshots`, gt: 4, extract: (d) => arr(d, 'data', 'snapshots').length },
  { name: 'audit (per-site logs)', endpoint: `/api/sites/${SITE}/logs?limit=200`, gt: 1, mode: 'populated', extract: (d) => arr(d, 'data', 'logs').length },
  { name: 'audit (org audit-logs)', endpoint: '/api/audit-logs?limit=50', gt: 50, extract: (d) => arr(d, 'data', 'logs').length },
  { name: 'voice numbers', endpoint: `/api/voice/numbers?siteId=${SITE}`, gt: 1, extract: (d) => arr(d, 'numbers', 'data').length },
  { name: 'mcp connections', endpoint: '/api/mcp/connections', gt: 2, extract: (d) => arr(d, 'data', 'connections').length },
];

// --- tiny envelope helpers (kept inline; no external deps) ---
function arr(d, ...keys) {
  if (Array.isArray(d)) return d;
  for (const k of keys) if (Array.isArray(d?.[k])) return d[k];
  return [];
}
function num(d, k) {
  const v = d?.[k];
  return typeof v === 'number' ? v : Number(v ?? NaN);
}

const r = await fetch('https://api.browserbase.com/v1/sessions', {
  method: 'POST', headers: { 'X-BB-API-Key': BB, 'Content-Type': 'application/json' },
  body: JSON.stringify({ projectId: PROJ, timeout: 600 }),
});
if (!r.ok) { console.log('session create failed', r.status); process.exit(3); }
const { id } = await r.json();
const browser = await chromium.connectOverCDP(`wss://connect.browserbase.com?apiKey=${encodeURIComponent(BB)}&sessionId=${encodeURIComponent(id)}`);
try {
  const ctx = browser.contexts()[0] ?? await browser.newContext();
  const page = ctx.pages()[0] ?? await ctx.newPage();
  await page.goto('https://projectsites.dev/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(7000); // CF managed-challenge solve

  // Log in as brian INSIDE the browser (CF-clean) and keep the token for authed fetches.
  const token = await page.evaluate(async (pw) => {
    const res = await fetch('/api/auth/test-login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'brian@megabyte.space', password: pw }),
    });
    const j = await res.json().catch(() => ({}));
    return j?.data?.token ?? '';
  }, PW);
  if (!token) { console.log('::error:: test-login returned no token'); process.exit(4); }

  const report = [];
  for (const s of SURFACES) {
    const res = await page.evaluate(async ({ endpoint, tok }) => {
      try {
        const r = await fetch(endpoint, { headers: { Authorization: `Bearer ${tok}` } });
        const text = await r.text();
        let body = null;
        try { body = JSON.parse(text); } catch { /* non-json */ }
        return { status: r.status, body, raw: text.slice(0, 120) };
      } catch (e) { return { status: 0, error: String(e).slice(0, 100) }; }
    }, { endpoint: s.endpoint, tok: token });

    let display = 'n/a';
    try { display = res.body != null ? s.extract(res.body) : 'no-json'; } catch { display = 'extract-err'; }
    const displayN = typeof display === 'number' && !Number.isNaN(display) ? display : 0;
    let verdict;
    if (res.status >= 400 || res.status === 0) verdict = `❌ HTTP ${res.status}${res.error ? ' ' + res.error : ''}`;
    // Windowed/subset surfaces: the only failure is lying-empty (shows 0 while data
    // exists). Any populated value is correct — the exact count drifts by design.
    else if (s.mode === 'populated') verdict = displayN > 0 ? `✅ OK (populated: ${displayN})` : '🔴 LYING-EMPTY (data exists, shows 0)';
    else if (s.gt > 0 && displayN === 0) verdict = '🔴 LYING-EMPTY (gt>0, shows 0)';
    else if (s.gt > 0 && displayN < s.gt * 0.5) verdict = `🟠 PARTIAL (gt=${s.gt}, shows ${displayN})`;
    else verdict = '✅ OK';
    report.push({ surface: s.name, endpoint: s.endpoint, groundTruth: s.gt, display, status: res.status, verdict });
  }
  console.log('\n=== ADMIN DATA RECONCILIATION (display vs D1 ground truth, as brian) ===\n');
  for (const row of report) {
    console.log(`${row.verdict.padEnd(34)} ${String(row.surface).padEnd(42)} gt=${String(row.groundTruth).padEnd(5)} shows=${row.display}`);
  }
  const bugs = report.filter((r) => r.verdict.startsWith('🔴') || r.verdict.startsWith('🟠') || r.verdict.startsWith('❌'));
  console.log(`\n${bugs.length} divergence(s) found:`);
  for (const b of bugs) console.log(`  - ${b.surface}: ${b.verdict} → ${b.endpoint}`);
  console.log(JSON.stringify(report, null, 0));
} finally {
  await browser.close();
}
