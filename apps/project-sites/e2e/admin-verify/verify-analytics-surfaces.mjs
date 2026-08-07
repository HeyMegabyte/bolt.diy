#!/usr/bin/env node
/** verify-analytics-surfaces.mjs — DISPLAY reconciliation for the analytics OVERVIEW
 * (visitor_events fallback) + LIVE tab (/api/analytics-data). Logs in as brian
 * (real browser, Browserbase) and fetches, for the megabytespace site:
 *   - /api/sites/:id/analytics        (owner summary — traffic.pageviews should be >0)
 *   - /api/analytics-data?siteId=:id  (LIVE tab events feed)
 *   - /api/sites/:id/multi-url-analytics?range=30d (CF-zone — empty for subdomains)
 * Reconcile: overview shows real pv (fallback works); live feed shows real events
 * (once repointed off the dead analytics_events table). Exits 0 (skip) if creds unset.
 * Creds (get-secret): BROWSERBASE_API_KEY, BROWSERBASE_PROJECT_ID, E2E_TEST_PASSWORD. */
import { chromium } from '@playwright/test';
const BB = process.env.BROWSERBASE_API_KEY, PROJ = process.env.BROWSERBASE_PROJECT_ID, PW = process.env.E2E_TEST_PASSWORD;
const SITE = process.argv[2] || 'site-megabytespace-001';
if (!BB || !PROJ || !PW) { console.log('::notice:: skipped — creds unset'); process.exit(0); }
const r = await fetch('https://api.browserbase.com/v1/sessions', { method: 'POST', headers: { 'X-BB-API-Key': BB, 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: PROJ, timeout: 300 }) });
if (!r.ok) { console.log('session create failed', r.status); process.exit(3); }
const { id } = await r.json();
const browser = await chromium.connectOverCDP(`wss://connect.browserbase.com?apiKey=${encodeURIComponent(BB)}&sessionId=${encodeURIComponent(id)}`);
try {
  const ctx = browser.contexts()[0] ?? await browser.newContext();
  const page = ctx.pages()[0] ?? await ctx.newPage();
  await page.goto('https://projectsites.dev/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(6000);
  const out = await page.evaluate(async ({ pw, site }) => {
    const login = await fetch('/api/auth/test-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'brian@megabyte.space', password: pw }) });
    const lj = await login.json().catch(() => ({}));
    const token = lj?.data?.token;
    if (!token) return { loginStatus: login.status, error: 'no token' };
    const h = { Authorization: `Bearer ${token}` };
    const summary = await (await fetch(`/api/sites/${site}/analytics?windowDays=30`, { headers: h })).json().catch(() => null);
    const live = await (await fetch(`/api/analytics-data?siteId=${site}&limit=100`, { headers: h })).json().catch(() => null);
    const cf = await (await fetch(`/api/sites/${site}/multi-url-analytics?range=30d`, { headers: h })).json().catch(() => null);
    return {
      loginStatus: login.status,
      overview_traffic: summary?.traffic ? { pageviews: summary.traffic.pageviews, uniqueSessions: summary.traffic.uniqueSessions, conversions: summary.traffic.conversions } : summary,
      overview_contacts: summary?.contacts ? { total: summary.contacts.total, newInWindow: summary.contacts.newInWindow, bySource: summary.contacts.bySource } : null,
      live_feed: live ? { count: live.count, note: live.note, first: (live.events || [])[0] ?? null } : live,
      cf_zone: cf ? { any_real_data: cf.data?.any_real_data ?? cf.any_real_data, pageviews: cf.data?.pageviews ?? cf.pageviews } : cf,
    };
  }, { pw: PW, site: SITE });
  console.log(JSON.stringify(out, null, 2));
} finally { await browser.close(); }
