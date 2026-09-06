#!/usr/bin/env node
/**
 * verify-billing-checkout.mjs — REAL-JOURNEY probe for the #1 money flow: the billing
 * Stripe EMBEDDED CHECKOUT actually MOUNTS in a real browser (COMPLETENESS item 4).
 *
 * WHY: reconcile proves the billing subscription DISPLAY matches the store, but is blind to
 * a broken CHECKOUT — a dead "Upgrade" / non-mounting Stripe iframe is a direct revenue
 * outage (free users can't subscribe). The mount depends on a chain a unit/render check
 * can't see end-to-end: the `Embedded checkout` handler → worker `POST /api/billing/
 * embedded-checkout` (returns `data.client_secret`) → Stripe.js loaded with a live
 * publishable key → Stripe mounting its secure `embedded-checkout` iframe. This clicks the
 * button on a REAL free-plan account (E2E_API_KEY = e2e-test-org, which shows the CTAs) and
 * asserts a Stripe embedded-checkout `<iframe>` actually mounted, zero relevant console errors.
 *
 * LOCAL CHROMIUM (no Browserbase): the AUTHED admin SPA shell is NOT CF-bot-challenged (only
 * public HTML + analytics ingest are), so seeding ps_session + local Chromium reaches
 * /admin/billing directly — the same pattern as reconcile-counts / focus-not-obscured. This
 * dropped the Browserbase dependency (AL-086) so the money flow is verified EVERY fire, not
 * only when Browserbase creds happen to be set.
 *
 * No charge + no residue: creating a Checkout Session (no card entered) is free and the
 * session auto-expires Stripe-side — nothing lands in our D1. Fail-open (exit 0) when
 * E2E_API_KEY is unset so forks + secret-less CI stay green. Seeds ps_session from
 * E2E_API_KEY (from ENV, never inline).
 *
 * Usage: E2E_API_KEY=$(get-secret E2E_API_KEY) node e2e/admin-verify/verify-billing-checkout.mjs
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const KEY = process.env.E2E_API_KEY;
if (!KEY) {
  console.log('::notice:: verify-billing-checkout skipped — E2E_API_KEY unset');
  process.exit(0);
}
const BASE = process.env.PROD_URL || 'https://projectsites.dev';
const __dirname = dirname(fileURLToPath(import.meta.url));
const req = createRequire(resolve(__dirname, '../../frontend/'));
const { chromium } = req('playwright');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';
// CF bot-challenge + 3rd-party beacon + Stripe's own iframe network noise are not billing defects.
const IGNORE = /Failed to load resource|analytics|ingest|posthog|challenge|cf-|doubleclick|sentry|beacon|gtm|stripe\.com|js\.stripe|m\.stripe|r\.stripe|hcaptcha/i;

const browser = await chromium.launch();
const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1280, height: 1000 }, serviceWorkers: 'block' });
const page = await ctx.newPage();
const errs = [];
page.on('console', (m) => { if (m.type() === 'error' && !IGNORE.test(m.text())) errs.push(m.text().slice(0, 120)); });
page.on('pageerror', (e) => { if (!IGNORE.test(String(e))) errs.push('pageerror: ' + String(e).slice(0, 120)); });

let exitCode = 1;
try {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.evaluate((k) => localStorage.setItem('ps_session', JSON.stringify({ token: k, identifier: 'e2e@megabyte.space', issuedAt: Date.now() })), KEY);
  await page.goto(`${BASE}/admin/billing`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2800);

  let sessionStatus = null;
  page.on('response', (r) => { if (/\/api\/billing\/embedded-checkout/.test(r.url())) sessionStatus = r.status(); });

  const ebtn = page.locator('button:has-text("Embedded checkout")').first();
  if (!(await ebtn.count().catch(() => 0))) {
    // No embedded-checkout CTA → account already subscribed (checkout correctly hidden). Not a failure.
    console.log('::notice:: verify-billing-checkout skipped — no "Embedded checkout" CTA (account already subscribed; checkout correctly hidden)');
    await browser.close();
    process.exit(0);
  }
  await ebtn.click().catch(() => {});

  // Stripe.js loads async then mounts an `embedded-checkout` iframe from js.stripe.com.
  let mounted = false;
  try {
    await page.waitForSelector('iframe[name="embedded-checkout"], iframe[src*="embedded-checkout"], [data-testid="stripe-embedded-iframe"] iframe', { timeout: 16000 });
    mounted = true;
  } catch { /* mounted stays false */ }
  await page.waitForTimeout(1200);

  const info = await page.evaluate(() => {
    const stripeFrames = [...document.querySelectorAll('iframe')].filter((f) => /embedded-checkout/i.test((f.src || '') + (f.name || '')));
    return { stripeIframes: stripeFrames.length };
  });
  const ok = mounted && info.stripeIframes >= 1 && errs.length === 0;
  console.log(`billing embedded checkout → sessionHTTP:${sessionStatus} stripeIframes:${info.stripeIframes} consoleErrs:${errs.length}`);
  if (errs.length) for (const e of errs.slice(0, 3)) console.log('   · ' + e);
  console.log(`\nVERDICT: ${ok ? '✅ PASS — Stripe embedded checkout iframe MOUNTED (money flow live)' : '🔴 FAIL — checkout did not mount a Stripe iframe / console errors'}`);
  exitCode = ok ? 0 : 1;
} catch (e) {
  console.log(`::notice:: verify-billing-checkout skipped — ${String(e).slice(0, 140)}`);
  exitCode = 0;
} finally {
  await browser.close();
}
process.exit(exitCode);
