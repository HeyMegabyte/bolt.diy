#!/usr/bin/env node
/** verify-form-funnel.mjs — DISPLAY-side reconciliation for the analytics_events→
 * visitor_events repoint. Logs in as brian@megabyte.space (real browser, Browserbase),
 * then fetches the 3 repointed owner-analytics endpoints for the megabytespace site
 * with the ps_session Bearer and prints the JSON. Reconcile against the D1 ground
 * truth: forms (AN17), sections (AN27), funnel (AN19) must show REAL numbers, not
 * "No form activity yet" / empty. Exits 0 (skip) if creds unset.
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
    const get = async (suffix) => {
      const res = await fetch(`/api/sites/${site}/analytics${suffix}`, { headers: { Authorization: `Bearer ${token}` } });
      return { status: res.status, body: await res.json().catch(() => null) };
    };
    return {
      loginStatus: login.status,
      forms: await get('/forms'),
      sections: await get('/sections'),
      funnel: await get('/funnel'),
    };
  }, { pw: PW, site: SITE });
  console.log(JSON.stringify(out, null, 2));
} finally { await browser.close(); }
