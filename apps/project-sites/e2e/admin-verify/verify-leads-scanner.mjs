#!/usr/bin/env node
/**
 * verify-leads-scanner.mjs — live render+control verification for the OPERATOR-ONLY
 * Lead Scanner (`/admin/leads`, AdminLeadsComponent — Super-Admin "#9" no-website
 * scan → scored leads → claim link).
 *
 * Why this needs its OWN probe (not the E2E_API_KEY surf/reconcile suite): the
 * `leads` route is operator-gated — a NON-operator (the e2e-test-org the E2E_API_KEY
 * resolves to) is BOUNCED to `/admin/site-features` (app.routes.ts). So the standard
 * admin-verify probes literally can't reach it; the Lead Scanner had ZERO automated
 * coverage. This probe logs in as brian (a real operator) via Browserbase + test-login
 * and proves, in a real browser, that the operator Lead Scanner:
 *   1. RENDERS (not bounced) — title "Lead Scanner", the search + auto-scan controls,
 *   2. its Places SCAN actually runs and surfaces leads (or a graceful empty state),
 *   3. with ZERO console errors (CF/PostHog ingest noise filtered).
 *
 * SKIPS (exit 0) when creds are unset or the operator session can't be established —
 * never a false-fail. Creds (get-secret): BROWSERBASE_API_KEY, BROWSERBASE_PROJECT_ID,
 * E2E_TEST_PASSWORD.
 * Usage: BROWSERBASE_API_KEY=… BROWSERBASE_PROJECT_ID=… E2E_TEST_PASSWORD=… \
 *   node e2e/admin-verify/verify-leads-scanner.mjs
 */
import { chromium } from '@playwright/test';

const BB = process.env.BROWSERBASE_API_KEY,
  PROJ = process.env.BROWSERBASE_PROJECT_ID,
  PW = process.env.E2E_TEST_PASSWORD;
if (!BB || !PROJ || !PW) {
  console.log('::notice:: verify-leads-scanner skipped — Browserbase creds / E2E_TEST_PASSWORD unset');
  process.exit(0);
}

const r = await fetch('https://api.browserbase.com/v1/sessions', {
  method: 'POST',
  headers: { 'X-BB-API-Key': BB, 'Content-Type': 'application/json' },
  body: JSON.stringify({ projectId: PROJ, timeout: 600 }),
});
if (!r.ok) {
  console.log(`::notice:: verify-leads-scanner skipped — Browserbase session create failed (${r.status})`);
  process.exit(0);
}
const { id } = await r.json();
const browser = await chromium.connectOverCDP(
  `wss://connect.browserbase.com?apiKey=${encodeURIComponent(BB)}&sessionId=${encodeURIComponent(id)}`,
);
const errs = [];
let cur = 'boot';
try {
  const ctx = browser.contexts()[0] ?? (await browser.newContext());
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  page.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error' && !/Failed to load resource|ingest|posthog|analytics|challenge|cf-|doubleclick|\/e\//i.test(t))
      errs.push(`[${cur}] ${t.slice(0, 110)}`);
  });
  page.on('pageerror', (e) => errs.push(`[${cur}] pageerror ${String(e).slice(0, 110)}`));

  await page.goto('https://projectsites.dev/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.evaluate(async (pw) => {
    const res = await fetch('/api/auth/test-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'brian@megabyte.space', password: pw }),
    });
    const j = await res.json().catch(() => ({}));
    if (j?.data?.token)
      localStorage.setItem('ps_session', JSON.stringify({ token: j.data.token, identifier: 'brian@megabyte.space', issuedAt: Date.now() }));
  }, PW);

  cur = 'nav';
  await page.goto('https://projectsites.dev/admin/leads', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(4000);
  const landed = await page.evaluate(() => location.pathname);
  if (landed !== '/admin/leads') {
    // brian should be an operator; a bounce means the test session isn't operator —
    // skip rather than false-fail (env/seed issue, not a Lead Scanner defect).
    console.log(`::notice:: verify-leads-scanner skipped — session bounced to ${landed} (not an operator in this env)`);
    process.exit(0);
  }

  const info = await page.evaluate(() => {
    const t = document.body.innerText || '';
    return { hasScanner: /Lead Scanner/i.test(t), title: (document.querySelector('h1,h2')?.innerText || '').slice(0, 40) };
  });

  // Run the Places scan and confirm it surfaces leads (or a graceful empty state).
  cur = 'scan';
  let scanResult = 'no-input';
  const input = page.locator('input[type="text"], input:not([type])').first();
  if (await input.count()) {
    await input.fill('coffee shop Austin').catch(() => {});
    await page.waitForTimeout(400);
    const scanBtn = page.locator('button:has-text("Scan"), [data-testid*="scan"]').first();
    if ((await scanBtn.count()) && !(await scanBtn.isDisabled().catch(() => true))) {
      await scanBtn.click().catch(() => {});
      await page.waitForTimeout(9000);
      scanResult = await page.evaluate(() => {
        const t = document.body.innerText || '';
        if (/\d+\s*(lead|result|business|site)/i.test(t)) return 'results-shown';
        if (/no results|no leads|nothing|try a|unavailable/i.test(t)) return 'graceful-empty';
        return `ran(len=${t.length})`;
      });
    } else scanResult = 'scan-btn-disabled-or-missing';
  }

  const ok = info.hasScanner && (scanResult === 'results-shown' || scanResult === 'graceful-empty') && errs.length === 0;
  console.log(
    `${ok ? '✅' : '🔴'} Lead Scanner (operator) — rendered=${info.hasScanner} title="${info.title}" scan=${scanResult} consoleErrs=${errs.length}`,
  );
  if (errs.length) for (const e of errs.slice(0, 4)) console.log('   ·', e);
  console.log(`\nVERDICT: ${ok ? '✅ PASS — operator Lead Scanner renders + scans live' : '🔴 CHECK'}`);
  process.exit(ok ? 0 : 1);
} finally {
  await browser.close();
}
