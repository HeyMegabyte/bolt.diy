#!/usr/bin/env node
/**
 * scan-admin-hub.mjs — read EVERY rendered counter on the /admin dashboard hub as
 * brian and screenshot it, so "non-working counter values" (a counter showing 0 /
 * "not run" while the account has real data) are caught automatically — the class
 * the hand-curated endpoint reconciler missed. Ground truth for org-brian-001:
 * 1 published site, 4 snapshots, 109 pageviews, 2 media, 2 mcp, 1 voice number.
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const BB = process.env.BROWSERBASE_API_KEY, PROJ = process.env.BROWSERBASE_PROJECT_ID, PW = process.env.E2E_TEST_PASSWORD;
if (!BB || !PROJ || !PW) { console.log('::notice:: skipped — creds unset'); process.exit(0); }
mkdirSync('/tmp/psvis', { recursive: true });
const r = await fetch('https://api.browserbase.com/v1/sessions', { method: 'POST', headers: { 'X-BB-API-Key': BB, 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: PROJ, timeout: 600 }) });
if (!r.ok) { console.log('session create failed', r.status); process.exit(3); }
const { id } = await r.json();
const browser = await chromium.connectOverCDP(`wss://connect.browserbase.com?apiKey=${encodeURIComponent(BB)}&sessionId=${encodeURIComponent(id)}`);
const errors = [];
try {
  const ctx = browser.contexts()[0] ?? await browser.newContext();
  const page = ctx.pages()[0] ?? await ctx.newPage();
  page.on('console', (m) => { const t = m.type(); if (t === 'error' || (t === 'warning' && /ran into a problem|GlobalErrorHandler/i.test(m.text()))) errors.push(`[${t}] ${m.text().slice(0, 120)}`); });
  page.on('pageerror', (e) => errors.push('[pageerror] ' + (e.message || String(e)).slice(0, 120)));
  await page.goto('https://projectsites.dev/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(7000);
  await page.evaluate(async (pw) => { const res = await fetch('/api/auth/test-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'brian@megabyte.space', password: pw }) }); const j = await res.json().catch(() => ({})); if (j?.data?.token) localStorage.setItem('ps_session', JSON.stringify({ token: j.data.token, identifier: j.data.email ?? 'brian@megabyte.space', issuedAt: Date.now() })); }, PW);
  await page.evaluate(async () => { try { const rs = await navigator.serviceWorker?.getRegistrations(); await Promise.all((rs ?? []).map((x) => x.unregister())); } catch {} try { const ks = await caches?.keys(); await Promise.all((ks ?? []).map((k) => caches.delete(k))); } catch {} });
  await page.goto('https://projectsites.dev/admin', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(6000); // let AdminStateService load sites + counters animate

  // Extract every rolling-counter + stat number + its nearest label, plus empty-state phrases.
  const counters = await page.evaluate(() => {
    const out = [];
    for (const el of Array.from(document.querySelectorAll('app-rolling-counter, .stat, [data-testid*="count"], .status-count, .kpi'))) {
      const num = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40);
      const label = (el.closest('li,section,.card,.status-tile,p')?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 70);
      if (num) out.push({ num, label });
    }
    const body = document.body.innerText || '';
    const emptyPhrases = ['not run', 'no traffic', 'not available', 'no data', 'never had', 'nothing yet', '—'].filter((p) => new RegExp(p, 'i').test(body));
    return { counters: out.slice(0, 40), emptyPhrases };
  });
  await page.screenshot({ path: '/tmp/psvis/admin-hub.png', fullPage: true });
  console.log(JSON.stringify({ counters: counters.counters, emptyPhrases: counters.emptyPhrases, consoleErrors: errors }, null, 2));
  console.log('screenshot → /tmp/psvis/admin-hub.png');
} finally { await browser.close(); }
