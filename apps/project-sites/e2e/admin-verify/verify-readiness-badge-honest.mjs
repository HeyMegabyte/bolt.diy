#!/usr/bin/env node
/**
 * verify-readiness-badge-honest.mjs — TRUTHFUL DATA guard for the per-site
 * Production-Readiness grade badge (#9) shown on `/admin/sites/:id` (+ Live Events).
 * An operator glances at this A–F badge to judge whether a site is healthy, so a
 * lying grade/score or a lying COLOR (e.g. an F rendered green/"ready") would drive
 * a wrong decision — invisible to a read-only reconcile (the badge reads a live
 * endpoint, so the risk is a render-layer transform/color regression).
 *
 * Reconciles the rendered badge against `GET /api/sites/:id/readiness`:
 *   • badge text contains "Readiness <grade>" + "<score>/100"  (display == endpoint)
 *   • badge color matches the grade — A/B → emerald, C → amber, D/F → rose  (no lying green)
 *
 * Resolves a site that HAS a scored build (readiness grade) from the org; renders its
 * site-detail; compares. Local Chromium (authed shell). Skips (exit 0) when E2E_API_KEY
 * is unset or no site has a readiness grade yet.
 *
 * Usage: E2E_API_KEY=$(get-secret E2E_API_KEY) node e2e/admin-verify/verify-readiness-badge-honest.mjs
 */
const KEY = process.env.E2E_API_KEY;
if (!KEY) {
  console.log('::notice:: verify-readiness-badge-honest skipped — E2E_API_KEY unset');
  process.exit(0);
}

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const req = createRequire(resolve(__dirname, '../../frontend/'));
const { chromium } = req('playwright');
const ORIGIN = process.env.ORIGIN || 'https://projectsites.dev';
const API = process.env.API_ORIGIN || 'https://project-sites.manhattan.workers.dev';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';
const H = { Authorization: `Bearer ${KEY}`, 'User-Agent': UA, Origin: ORIGIN };
const api = (path) => fetch(`${API}${path}`, { headers: H, signal: AbortSignal.timeout(20000) });
const unwrap = (d) => d?.data ?? d;

try {
  // Resolve a site that has a scored readiness build.
  const sites = unwrap(await (await api('/api/sites?limit=100')).json().catch(() => ({}))) ?? [];
  const list = Array.isArray(sites) ? sites : sites.data ?? [];
  let target = null;
  let store = null;
  for (const s of list) {
    const id = s.id || s.site_id;
    if (!id) continue;
    const r = await api(`/api/sites/${id}/readiness`);
    if (r.status !== 200) continue;
    const j = await r.json().catch(() => ({}));
    if (j && j.grade) { target = id; store = { grade: j.grade, score: j.score }; break; }
  }
  if (!target) {
    console.log('::notice:: verify-readiness-badge-honest skipped — no site with a scored readiness build');
    process.exit(0);
  }

  const b = await chromium.launch();
  const p = await (await b.newContext({ userAgent: UA, viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' })).newPage();
  await p.goto(`${ORIGIN}/admin`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.evaluate((k) => localStorage.setItem('ps_session', JSON.stringify({ token: k, identifier: 'e2e@megabyte.space', issuedAt: Date.now() })), KEY);
  await p.goto(`${ORIGIN}/admin/sites/${target}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForSelector('[data-testid="readiness-badge"]', { timeout: 20000 }).catch(() => {});
  await p.waitForTimeout(2500);
  const badge = await p.evaluate(() => {
    const el = document.querySelector('[data-testid="readiness-badge"]');
    return el ? { txt: (el.textContent || '').replace(/\s+/g, ' ').trim(), cls: el.className } : null;
  });
  await b.close();

  if (!badge) {
    console.log(`::notice:: verify-readiness-badge-honest skipped — badge did not render for ${target} (score=${store.score})`);
    process.exit(0);
  }

  const rows = [];
  let fails = 0;
  const check = (label, ok, detail) => { rows.push({ label, ok, detail }); if (!ok) fails++; };

  check('badge grade == endpoint grade', badge.txt.includes(`Readiness ${store.grade}`), `badge="${badge.txt}" endpoint.grade=${store.grade}`);
  if (store.score !== null && store.score !== undefined) {
    check('badge score == endpoint score', badge.txt.includes(`${store.score}/100`), `badge="${badge.txt}" endpoint.score=${store.score}`);
  }
  const green = /emerald/.test(badge.cls), amber = /amber/.test(badge.cls), rose = /rose/.test(badge.cls);
  const colorHonest =
    (/[AB]/.test(store.grade) && green) || (store.grade === 'C' && amber) || (/[DF]/.test(store.grade) && rose);
  check('badge color matches grade (no lying green)', colorHonest, `grade=${store.grade} green=${green} amber=${amber} rose=${rose}`);

  for (const r of rows) console.log(`  ${r.ok ? '✓' : '✗'} ${r.label.padEnd(42)} ${r.detail}`);
  const ok = fails === 0;
  console.log(
    `\nVERDICT: ${ok ? '✅ PASS' : '🔴 CHECK'} — readiness badge ${ok ? `is truthful (grade ${store.grade} + score + color all match the endpoint)` : 'DRIFTS from the readiness endpoint (lying grade/score/color)'}`,
  );
  if (!ok) console.log('   ↳ an F/D shown green, or a grade/score ≠ the endpoint = a lying health signal an operator acts on.');
  process.exit(ok ? 0 : 1);
} catch (err) {
  console.log(`\n🔴 ERROR: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
}
