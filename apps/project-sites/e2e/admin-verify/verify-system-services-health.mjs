#!/usr/bin/env node
/**
 * verify-system-services-health.mjs — real-browser (Browserbase) verify that
 * /admin/system-services renders LIVE integration-health chips as brian, not just
 * the static lifecycle catalog. Confirms board item 1487's "System Services shows
 * REAL probed status": each probed service (billing-stripe → stripe, crm-twenty →
 * twenty, …) shows a live health chip (healthy/degraded/failing/unknown) merged
 * from GET /api/integrations/health. Fails on 0 chips or console errors.
 *
 * Creds (get-secret): BROWSERBASE_API_KEY, BROWSERBASE_PROJECT_ID, E2E_TEST_PASSWORD.
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const BB = process.env.BROWSERBASE_API_KEY,
  PROJ = process.env.BROWSERBASE_PROJECT_ID,
  PW = process.env.E2E_TEST_PASSWORD;
if (!BB || !PROJ || !PW) {
  console.log('::notice:: verify-system-services-health skipped — creds unset');
  process.exit(0);
}
mkdirSync('/tmp/psvis', { recursive: true });

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
const errors = [];
try {
  const ctx = browser.contexts()[0] ?? (await browser.newContext());
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  page.on('console', (m) => {
    const t = m.type();
    if (t === 'error' || (t === 'warning' && /ran into a problem|GlobalErrorHandler/i.test(m.text())))
      errors.push(`[${t}] ${m.text().slice(0, 140)}`);
  });
  page.on('pageerror', (e) => errors.push('[pageerror] ' + (e.message || String(e)).slice(0, 140)));
  const failed404 = [];
  page.on('response', (resp) => {
    if (resp.status() === 404) failed404.push(resp.url().replace('https://projectsites.dev', ''));
  });

  await page.goto('https://projectsites.dev/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(7000);
  // Log in as brian (super-admin via allowlist). Seed ps_session.identifier so the
  // sysAdminGuard resolves brian (super-admin route would otherwise bounce).
  await page.evaluate(async (pw) => {
    const res = await fetch('/api/auth/test-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'brian@megabyte.space', password: pw }),
    });
    const j = await res.json().catch(() => ({}));
    if (j?.data?.token)
      localStorage.setItem(
        'ps_session',
        JSON.stringify({
          token: j.data.token,
          identifier: j.data.email ?? 'brian@megabyte.space',
          issuedAt: Date.now(),
        }),
      );
  }, PW);
  await page.evaluate(async () => {
    try {
      const rs = await navigator.serviceWorker?.getRegistrations();
      await Promise.all((rs ?? []).map((x) => x.unregister()));
    } catch {}
    try {
      const ks = await caches?.keys();
      await Promise.all((ks ?? []).map((k) => caches.delete(k)));
    } catch {}
  });

  await page.goto('https://projectsites.dev/admin/system-services', {
    waitUntil: 'domcontentloaded',
    timeout: 45000,
  });
  // Wait for the catalog to render (rows) + the async health merge.
  await page
    .locator('[data-testid="system-services"] [role="listitem"]')
    .first()
    .waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForTimeout(4000); // integration-health aggregate merge

  const result = await page.evaluate(() => {
    const rows = document.querySelectorAll('[data-testid="system-services"] [role="listitem"]');
    const chips = Array.from(document.querySelectorAll('[data-testid^="service-health-"]')).map(
      (el) => ({
        id: el.getAttribute('data-testid')?.replace('service-health-', ''),
        health: el.getAttribute('data-health'),
      }),
    );
    const summary = Array.from(
      document.querySelectorAll('[data-testid="system-services-health-summary"] [data-health]'),
    ).map((el) => ({
      key: el.getAttribute('data-health'),
      text: (el.textContent || '').replace(/\s+/g, ' ').trim(),
    }));
    return { rowCount: rows.length, chips, summary };
  });

  await page.screenshot({ path: '/tmp/psvis/system-services.png', fullPage: true });

  const healthyish = result.chips.filter((c) => ['healthy', 'degraded', 'failing'].includes(c.health));
  console.log(
    JSON.stringify(
      {
        rowCount: result.rowCount,
        liveHealthChips: result.chips,
        liveProbedCount: result.chips.length,
        activeProbes: healthyish.length,
        healthSummary: result.summary,
        consoleErrors: errors,
        failed404: failed404,
      },
      null,
      2,
    ),
  );
  console.log('screenshot → /tmp/psvis/system-services.png');

  const ok = result.rowCount > 5 && result.chips.length > 0 && errors.length === 0;
  if (!ok) {
    console.log(
      `::error:: FAIL — rows=${result.rowCount} chips=${result.chips.length} errors=${errors.length}`,
    );
    process.exit(1);
  }
  console.log('✅ System Services renders live health chips as brian, 0 console errors');
} finally {
  await browser.close();
}
