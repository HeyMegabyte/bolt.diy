#!/usr/bin/env node
/**
 * scan-admin-sections.mjs — the comprehensive rendered-surface finder. Logs in as
 * brian and visits EVERY admin section, selecting the site where the section is
 * site-scoped, then extracts what the user actually SEES: rendered counters, table
 * row counts, empty-state phrases, console errors/warnings, failed requests, and
 * error-boundary crashes. Flags any section that shows empty/0/"not available" while
 * brian's account has real data (ground-truth map below), plus any console error /
 * failed request / crash. This catches the frontend-render bugs (lying-empty counters,
 * wrong-source panels, crashed sections) that endpoint checks cannot — per the rule
 * verify-against-source-of-truth.
 *
 * Ground truth (org-brian-001 / site-megabytespace-001): sites 1 · visitor_events
 * 109pv · analytics_daily 9 · media 2 · snapshots 4 · audit 1129 · voice 1 · mcp 2 ·
 * api_tokens 1 · (forms/leads/social/subs/apps/notifications/hostnames = 0 honest-empty).
 *
 * Creds (get-secret): BROWSERBASE_API_KEY, BROWSERBASE_PROJECT_ID, E2E_TEST_PASSWORD.
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const BB = process.env.BROWSERBASE_API_KEY, PROJ = process.env.BROWSERBASE_PROJECT_ID, PW = process.env.E2E_TEST_PASSWORD;
if (!BB || !PROJ || !PW) { console.log('::notice:: skipped — creds unset'); process.exit(0); }
mkdirSync('/tmp/psvis', { recursive: true });

// path · whether the section is site-scoped (needs the site-switcher) · concepts with
// real data (so "empty" here = a bug) · concepts that are honestly empty (0 is fine).
const SECTIONS = [
  { path: '/admin/analytics', site: true, expectData: true },
  // /admin/media aliases to the editor (Code tab); media is the editor's MEDIA TAB,
  // not a standalone section — so a section-scan false-flags it. Media is verified
  // separately by verify-media-tab.mjs (clicks the tab → 7 real assets render).
  { path: '/admin/media', site: false, expectData: false },
  { path: '/admin/snapshots', site: true, expectData: true },
  { path: '/admin/logs', site: false, expectData: true },
  { path: '/admin/voice', site: true, expectData: true },
  { path: '/admin/mcp', site: false, expectData: true },
  { path: '/admin/settings', site: false, expectData: true },
  { path: '/admin/domains', site: true, expectData: true },
  { path: '/admin/forms', site: true, expectData: true },
  { path: '/admin/social', site: true, expectData: true },
  // /admin/leads = the Lead SCANNER (external-prospect scanning, scored) — a DIFFERENT
  // concept than inbound leads; populated by running a scan, not by the leads table.
  { path: '/admin/leads', site: false, expectData: false },
  // /admin/apps = the static app CATALOG (67 entries, card grid — always "populated",
  // not brian-scoped data). The INSTALLED instances live at /admin/apps/instances.
  { path: '/admin/apps', site: false, expectData: false },
  { path: '/admin/apps/instances', site: false, expectData: true },
  { path: '/admin/billing', site: false, expectData: true },
  { path: '/admin/site-features', site: true, expectData: false },
  { path: '/admin/seo', site: true, expectData: false },
  { path: '/admin/feature-flags', site: false, expectData: false },
  { path: '/admin/system-services', site: false, expectData: false },
];
const nameOf = (p) => p.replace(/^\/admin\/?/, '') || 'hub';

const r = await fetch('https://api.browserbase.com/v1/sessions', { method: 'POST', headers: { 'X-BB-API-Key': BB, 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: PROJ, timeout: 800 }) });
if (!r.ok) { console.log('session create failed', r.status); process.exit(3); }
const { id } = await r.json();
const browser = await chromium.connectOverCDP(`wss://connect.browserbase.com?apiKey=${encodeURIComponent(BB)}&sessionId=${encodeURIComponent(id)}`);
let current = 'boot';
const errs = {}, failed = {};
try {
  const ctx = browser.contexts()[0] ?? await browser.newContext();
  const page = ctx.pages()[0] ?? await ctx.newPage();
  page.on('console', (m) => { const t = m.type(); const txt = m.text(); if (/Failed to load resource/i.test(txt)) return; /* network 4xx/5xx already tracked by the response handler, which filters 3rd-party (gstatic) noise */ if (t === 'error' || (t === 'warning' && /ran into a problem|GlobalErrorHandler|Unhandled/i.test(txt))) (errs[current] ??= []).push(`[${t}] ${txt.slice(0, 110)}`); });
  page.on('pageerror', (e) => (errs[current] ??= []).push('[pageerror] ' + (e.message || String(e)).slice(0, 110)));
  // Exclude 3rd-party noise: analytics beacons + Google's gstatic favicon service
  // (t*.gstatic.com/faviconV2) which 404s for domains it lacks — not an app bug.
  page.on('response', (res) => { if (res.status() >= 400 && !/google-analytics|\/g\/collect|posthog|gstatic\.com|faviconV2/.test(res.url())) (failed[current] ??= []).push(res.status() + ' ' + res.url().replace('https://projectsites.dev', '').slice(0, 70)); });

  await page.goto('https://projectsites.dev/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(7000);
  await page.evaluate(async (pw) => { const res = await fetch('/api/auth/test-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'brian@megabyte.space', password: pw }) }); const j = await res.json().catch(() => ({})); if (j?.data?.token) localStorage.setItem('ps_session', JSON.stringify({ token: j.data.token, identifier: j.data.email ?? 'brian@megabyte.space', issuedAt: Date.now() })); }, PW);
  await page.evaluate(async () => { try { const rs = await navigator.serviceWorker?.getRegistrations(); await Promise.all((rs ?? []).map((x) => x.unregister())); } catch {} try { const ks = await caches?.keys(); await Promise.all((ks ?? []).map((k) => caches.delete(k))); } catch {} });

  const report = {};
  for (const s of SECTIONS) {
    const name = nameOf(s.path); current = name;
    try {
      await page.goto('https://projectsites.dev' + s.path, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(4000);
      if (s.site) {
        try {
          const sw = page.locator('button[aria-label="Select site"]');
          if (await sw.count()) { await sw.click(); const opt = page.locator('button[role="option"]').first(); await opt.waitFor({ state: 'visible', timeout: 4000 }); await opt.click(); await page.waitForTimeout(3500); }
        } catch {}
      }
      await page.waitForTimeout(1500);
      const info = await page.evaluate(() => {
        const body = document.body.innerText || '';
        const counters = Array.from(document.querySelectorAll('app-rolling-counter, .stat, .kpi, .status-count')).map((e) => (e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 24)).filter(Boolean).slice(0, 12);
        const rows = document.querySelectorAll('tbody tr, [role="row"], .data-row, li[data-testid]').length;
        const empty = ['not available', 'no traffic', 'not run', 'coming soon', 'nothing yet', 'no data', 'never had', 'not configured', 'no results', 'stub'].filter((p) => new RegExp(p, 'i').test(body));
        return { h1: (document.querySelector('h1,h2')?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40), mainLen: (document.querySelector('main')?.innerText || body).trim().length, rows, counters, empty, crashed: /ran into a problem|something went wrong/i.test(body) };
      });
      await page.screenshot({ path: `/tmp/psvis/sec-${name}.png`, fullPage: false });
      report[name] = { ...info, expectData: s.expectData, errors: errs[name] ?? [], failed: (failed[name] ?? []).slice(0, 5) };
    } catch (e) { report[name] = { FAIL: String(e).slice(0, 90), errors: errs[name] ?? [], failed: failed[name] ?? [] }; }
  }

  console.log('\n=== ADMIN SECTION RENDER SCAN (as brian) ===\n');
  const bugs = [];
  for (const [name, r] of Object.entries(report)) {
    const flags = [];
    if (r.FAIL) flags.push('NAV-FAIL');
    if (r.crashed) flags.push('CRASHED');
    if ((r.errors ?? []).length) flags.push(`${r.errors.length} console-err`);
    if ((r.failed ?? []).length) flags.push(`${r.failed.length} failed-req`);
    if (r.expectData && r.rows === 0 && (r.counters ?? []).every((c) => /^0|^—|^\$0/.test(c))) flags.push('EMPTY-where-data-expected');
    const verdict = flags.length ? '🔴 ' + flags.join(', ') : '✅ ok';
    console.log(`${verdict.padEnd(40)} ${name.padEnd(16)} rows=${r.rows ?? '?'} counters=[${(r.counters ?? []).slice(0, 5).join('|')}] empty=[${(r.empty ?? []).join('|')}]`);
    if (flags.length) bugs.push({ name, path: '/admin/' + name, flags, errors: r.errors, failed: r.failed, empty: r.empty });
  }
  console.log(`\n${bugs.length} section(s) flagged:`);
  for (const b of bugs) console.log(`  - ${b.name}: ${b.flags.join(', ')}${b.errors?.length ? ' :: ' + b.errors[0] : ''}${b.failed?.length ? ' :: ' + b.failed[0] : ''}`);
} finally { await browser.close(); }
