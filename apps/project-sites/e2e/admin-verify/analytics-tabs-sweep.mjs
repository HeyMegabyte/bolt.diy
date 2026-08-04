#!/usr/bin/env node
/**
 * analytics-tabs-sweep.mjs — real-life per-tab verification of the Analytics
 * dashboard (`/admin/analytics`) as brian@megabyte.space via Browserbase, scoped
 * to a real site (megabytespace.projectsites.dev). Clicks EACH of the 8 tabs and
 * captures, PER TAB: console errors, failed requests (4xx/5xx, GA filtered), the
 * rendered panel text length, and whether a "not available / broken" state shows.
 * Screenshots each tab to /tmp/psvis/analytics-<tab>.png.
 *
 * Confirms each tab WORKS (renders + 0 errors + 0 failed requests), not just that
 * the section loads. Exits 0 (skip) if creds unset.
 *
 * Creds (get-secret): BROWSERBASE_API_KEY, BROWSERBASE_PROJECT_ID, E2E_TEST_PASSWORD.
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const BB = process.env.BROWSERBASE_API_KEY;
const PROJ = process.env.BROWSERBASE_PROJECT_ID;
const PW = process.env.E2E_TEST_PASSWORD;
if (!BB || !PROJ || !PW) {
  console.log('::notice:: analytics-tabs-sweep skipped — creds unset');
  process.exit(0);
}

const OUT = '/tmp/psvis';
mkdirSync(OUT, { recursive: true });
const TABS = ['overview', 'live', 'funnel', 'sections', 'forms', 'visitor', 'health', 'social'];
const isNoise = (t) =>
  /google-analytics|\/g\/collect|posthog|Failed to load resource: net::ERR|analytics\.google/i.test(t);

const r = await fetch('https://api.browserbase.com/v1/sessions', {
  method: 'POST',
  headers: { 'X-BB-API-Key': BB, 'Content-Type': 'application/json' },
  body: JSON.stringify({ projectId: PROJ, timeout: 600 }),
});
if (!r.ok) {
  console.log('session create failed', r.status);
  process.exit(3);
}
const { id } = await r.json();
const browser = await chromium.connectOverCDP(
  `wss://connect.browserbase.com?apiKey=${encodeURIComponent(BB)}&sessionId=${encodeURIComponent(id)}`,
);
const report = { _scope: null };
try {
  const ctx = browser.contexts()[0] ?? (await browser.newContext());
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.setViewportSize({ width: 1440, height: 900 });
  let current = 'boot';
  const errors = {};
  const failed = {};
  page.on('console', (m) => {
    if (m.type() === 'error' && !isNoise(m.text())) (errors[current] ??= []).push(m.text().slice(0, 160));
  });
  page.on('pageerror', (e) => (errors[current] ??= []).push('[pageerror] ' + (e.message || String(e)).slice(0, 160)));
  page.on('response', (res) => {
    const u = res.url();
    if (res.status() >= 400 && !isNoise(u)) (failed[current] ??= []).push(res.status() + ' ' + u.replace('https://projectsites.dev', '').slice(0, 90));
  });

  await page.goto('https://projectsites.dev/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(7000);
  const login = await page.evaluate(async (pw) => {
    const res = await fetch('/api/auth/test-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'brian@megabyte.space', password: pw }),
    });
    const j = await res.json().catch(() => ({}));
    const d = j?.data;
    if (d?.token) {
      try {
        localStorage.setItem('ps_session', JSON.stringify({ token: d.token, identifier: d.email ?? 'brian@megabyte.space', issuedAt: Date.now() }));
      } catch { /* private */ }
    }
    return { status: res.status, email: d?.email ?? null };
  }, PW);
  report._login = login;
  await page.evaluate(async () => {
    try {
      if (navigator.serviceWorker) {
        const rs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(rs.map((x) => x.unregister()));
      }
      if (window.caches) {
        const ks = await caches.keys();
        await Promise.all(ks.map((k) => caches.delete(k)));
      }
    } catch { /* ignore */ }
  });

  current = 'nav';
  await page.goto('https://projectsites.dev/admin/analytics', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(6000);
  report._scope = await page.evaluate(
    () => document.querySelector('[data-testid="scope-picker"], .scope-picker, header')?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 60) ?? null,
  );

  for (const t of TABS) {
    current = t;
    try {
      const tabBtn = page.locator(`[data-testid="analytics-tab-${t}"]`);
      await tabBtn.click({ timeout: 8000 });
      await page.waitForTimeout(4500); // let the tab's data load
      const info = await page.evaluate(() => {
        const body = document.body.innerText || '';
        const panel = document.querySelector('[data-testid="analytics-dashboard"]')?.parentElement?.innerText || body;
        return {
          panelLen: panel.trim().length,
          broken: /not available yet|something went wrong|failed to load|internal server error/i.test(body),
          activeTab: document.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute('data-testid') ?? null,
        };
      });
      await page.screenshot({ path: `${OUT}/analytics-${t}.png`, fullPage: false });
      report[t] = { ...info, errors: errors[t] ?? [], failed: (failed[t] ?? []).slice(0, 6) };
    } catch (e) {
      report[t] = { CLICK_FAIL: String(e).slice(0, 120), errors: errors[t] ?? [], failed: failed[t] ?? [] };
    }
  }
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
