#!/usr/bin/env node
/**
 * verify-analytics-fix.mjs — real-browser proof that /admin/analytics now renders
 * the AUTHORITATIVE visitor_events pageviews (109 for megabytespace) instead of the
 * empty CF-zone "No traffic yet". Logs in as brian, opens the analytics section,
 * selects the site, and reads the pageviews KPI + captures console errors.
 *
 * Creds (get-secret): BROWSERBASE_API_KEY, BROWSERBASE_PROJECT_ID, E2E_TEST_PASSWORD.
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const BB = process.env.BROWSERBASE_API_KEY;
const PROJ = process.env.BROWSERBASE_PROJECT_ID;
const PW = process.env.E2E_TEST_PASSWORD;
if (!BB || !PROJ || !PW) { console.log('::notice:: skipped — creds unset'); process.exit(0); }
mkdirSync('/tmp/psvis', { recursive: true });

const r = await fetch('https://api.browserbase.com/v1/sessions', {
  method: 'POST', headers: { 'X-BB-API-Key': BB, 'Content-Type': 'application/json' },
  body: JSON.stringify({ projectId: PROJ, timeout: 600 }),
});
if (!r.ok) { console.log('session create failed', r.status); process.exit(3); }
const { id } = await r.json();
const browser = await chromium.connectOverCDP(`wss://connect.browserbase.com?apiKey=${encodeURIComponent(BB)}&sessionId=${encodeURIComponent(id)}`);
const errors = [];
try {
  const ctx = browser.contexts()[0] ?? await browser.newContext();
  const page = ctx.pages()[0] ?? await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 140)); });
  page.on('pageerror', (e) => errors.push('[pageerror] ' + (e.message || String(e)).slice(0, 140)));

  await page.goto('https://projectsites.dev/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(7000);
  await page.evaluate(async (pw) => {
    const res = await fetch('/api/auth/test-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'brian@megabyte.space', password: pw }) });
    const j = await res.json().catch(() => ({}));
    if (j?.data?.token) localStorage.setItem('ps_session', JSON.stringify({ token: j.data.token, identifier: j.data.email ?? 'brian@megabyte.space', issuedAt: Date.now() }));
  }, PW);
  // Kill SW/caches so we render the freshly-deployed bundle.
  await page.evaluate(async () => {
    try { const rs = await navigator.serviceWorker?.getRegistrations(); await Promise.all((rs ?? []).map((x) => x.unregister())); } catch {}
    try { const ks = await caches?.keys(); await Promise.all((ks ?? []).map((k) => caches.delete(k))); } catch {}
  });
  await page.goto('https://projectsites.dev/admin/analytics', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(3500);

  // Select the site so the per-site panel loads (megabytespace = brian's only site).
  try {
    const sw = page.locator('button[aria-label="Select site"]');
    if (await sw.count()) {
      await sw.click();
      const opt = page.locator('button[role="option"]').first();
      await opt.waitFor({ state: 'visible', timeout: 5000 });
      await opt.click();
    }
  } catch (e) { errors.push('site-select: ' + String(e).slice(0, 80)); }
  await page.waitForTimeout(6000); // let the analytics forkJoin resolve + counter animate

  const read = async (sel) => (await page.locator(sel).first().innerText().catch(() => '')).trim().replace(/\s+/g, ' ');
  const parse = (s) => Number((s.match(/[\d,]+/)?.[0] || '0').replace(/,/g, ''));
  const kpiDefault = await read('[data-testid="kpi-pageviews"]');
  const bodyDefault = (await page.locator('body').innerText().catch(() => '')) || '';
  const noTrafficDefault = /no traffic yet|never had any traffic/i.test(bodyDefault);
  await page.screenshot({ path: '/tmp/psvis/analytics-fixed-7d.png', fullPage: false });

  // Switch to the 90d range — megabytespace has 109 pageviews over 90 days.
  let kpi90 = '';
  let noTraffic90 = null;
  try {
    await page.locator('button', { hasText: /^90d$/ }).first().click({ timeout: 5000 });
    await page.waitForTimeout(5000);
    kpi90 = await read('[data-testid="kpi-pageviews"]');
    const body90 = (await page.locator('body').innerText().catch(() => '')) || '';
    noTraffic90 = /no traffic yet|never had any traffic/i.test(body90);
    await page.screenshot({ path: '/tmp/psvis/analytics-fixed-90d.png', fullPage: false });
  } catch (e) { errors.push('90d-switch: ' + String(e).slice(0, 80)); }

  const pv7 = parse(kpiDefault);
  const pv90 = parse(kpi90);
  console.log(JSON.stringify({
    default_7d: { kpi: kpiDefault.slice(0, 70), pageviews: pv7, noTrafficCard: noTrafficDefault },
    range_90d: { kpi: kpi90.slice(0, 70), pageviews: pv90, noTrafficCard: noTraffic90 },
    consoleErrors: errors,
    verdict:
      pv7 > 0 && !noTrafficDefault && pv90 >= 100
        ? `✅ FIXED — 7d shows ${pv7}, 90d shows ${pv90}, no "No traffic yet" card`
        : `⚠️ CHECK — 7d=${pv7} (noTraffic=${noTrafficDefault}), 90d=${pv90}`,
  }, null, 2));
  console.log('screenshots → /tmp/psvis/analytics-fixed-{7d,90d}.png');
} finally {
  await browser.close();
}
