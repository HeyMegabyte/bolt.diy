#!/usr/bin/env node
/**
 * verify-forms-causal.mjs — CAUSAL test (verify-against-source-of-truth § causal test):
 * perform the action → assert the STORE records it → assert the DISPLAY surfaces it.
 * The seed INSERTed form_submissions directly, so the real INGESTION path (POST
 * /api/v1/forms/submit → form_submissions → /admin/forms) was never tested end-to-end.
 *
 * From a real browser (origin=projectsites.dev is allow-listed; real fingerprint passes
 * Bot Fight Mode — a direct curl 403s): submit a VALID + an INJECTION-shaped submission,
 * then log in as brian and assert /admin/forms shows them AND the XSS payload renders as
 * inert TEXT (Angular escapes it — no alert dialog fires). D1 cleanup is done by the caller.
 * Creds (get-secret): BROWSERBASE_API_KEY, BROWSERBASE_PROJECT_ID, E2E_TEST_PASSWORD.
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const BB = process.env.BROWSERBASE_API_KEY, PROJ = process.env.BROWSERBASE_PROJECT_ID, PW = process.env.E2E_TEST_PASSWORD;
if (!BB || !PROJ || !PW) { console.log('::notice:: skipped — creds unset'); process.exit(0); }
mkdirSync('/tmp/psvis', { recursive: true });
const VALID_EMAIL = 'causal-forms-test@example.com', INJ_EMAIL = 'causal-inject-test@example.com';
const INJ_NAME = "<script>alert(1)</script>";
const r = await fetch('https://api.browserbase.com/v1/sessions', { method: 'POST', headers: { 'X-BB-API-Key': BB, 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: PROJ, timeout: 600 }) });
if (!r.ok) { console.log('session create failed', r.status); process.exit(3); }
const { id } = await r.json();
const browser = await chromium.connectOverCDP(`wss://connect.browserbase.com?apiKey=${encodeURIComponent(BB)}&sessionId=${encodeURIComponent(id)}`);
let cur = 'boot'; const errs = []; let xssFired = false;
const out = {};
try {
  const ctx = browser.contexts()[0] ?? await browser.newContext();
  const page = ctx.pages()[0] ?? await ctx.newPage();
  page.on('console', (m) => { const t = m.type(), x = m.text(); if (/Failed to load resource/i.test(x)) return; if (t === 'error' || (t === 'warning' && /ran into a problem|GlobalErrorHandler|Unhandled|NG0/i.test(x))) errs.push(`[${cur}][${t}] ${x.slice(0, 120)}`); });
  page.on('pageerror', (e) => errs.push(`[${cur}][pageerror] ${(e.message || String(e)).slice(0, 120)}`));
  page.on('dialog', async (d) => { xssFired = true; await d.dismiss().catch(() => {}); }); // an alert() => XSS executed

  await page.goto('https://projectsites.dev/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(6000);
  // Clear SW + caches BEFORE the submit so the POST hits the NETWORK, not a stale SW
  // (rules out a service-worker interception faking the success).
  await page.evaluate(async () => { try { const rs = await navigator.serviceWorker?.getRegistrations(); await Promise.all((rs ?? []).map((x) => x.unregister())); } catch {} try { const ks = await caches?.keys(); await Promise.all((ks ?? []).map((k) => caches.delete(k))); } catch {} });
  await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForTimeout(2500);

  // ── SUBMIT (as a visitor, from an allow-listed origin) ──
  cur = 'submit';
  const submit = await page.evaluate(async ({ ve, ie, iname }) => {
    const post = async (email, fields) => {
      const res = await fetch('/api/v1/forms/submit', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Site-Slug': 'megabytespace' }, body: JSON.stringify({ form_name: 'Contact', email, fields }) });
      return { status: res.status, body: (await res.text()).slice(0, 160) };
    };
    return {
      valid: await post(ve, { name: 'Causal Test', message: 'End-to-end causal test of the forms ingestion path — a valid submission.' }),
      injection: await post(ie, { name: iname, message: "injection probe: '; DROP TABLE form_submissions;-- <img src=x onerror=alert(1)> end" }),
    };
  }, { ve: VALID_EMAIL, ie: INJ_EMAIL, iname: INJ_NAME });
  out.submit = submit;
  console.log('\n=== SUBMIT (visitor) ===\n' + JSON.stringify(submit, null, 2));

  // ── login as brian + display check ──
  cur = 'login';
  await page.evaluate(async (pw) => { const res = await fetch('/api/auth/test-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'brian@megabyte.space', password: pw }) }); const j = await res.json().catch(() => ({})); if (j?.data?.token) localStorage.setItem('ps_session', JSON.stringify({ token: j.data.token, identifier: j.data.email ?? 'brian@megabyte.space', issuedAt: Date.now() })); }, PW);
  await page.evaluate(async () => { try { const rs = await navigator.serviceWorker?.getRegistrations(); await Promise.all((rs ?? []).map((x) => x.unregister())); } catch {} try { const ks = await caches?.keys(); await Promise.all((ks ?? []).map((k) => caches.delete(k))); } catch {} });

  // TECHNICAL: fetch the forms list as brian → does it include the 2 new submissions?
  cur = 'forms-api';
  const apiRows = await page.evaluate(async () => {
    const tok = JSON.parse(localStorage.getItem('ps_session') || '{}').token;
    const res = await fetch('/api/sites/site-megabytespace-001/forms', { headers: { Authorization: `Bearer ${tok}` } });
    const j = await res.json().catch(() => ({}));
    const rows = j?.data ?? [];
    return { total: rows.length, causalEmails: rows.map((r) => r.email).filter((e) => /causal-/.test(e || '')) };
  });
  out.formsApi = apiRows;

  // VISUAL: /admin/forms → the injection submission rendered as inert text?
  cur = 'forms-ui';
  await page.goto('https://projectsites.dev/admin/forms', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(4500);
  // Select the SAME site we submitted to (X-Site-Slug: megabytespace). /admin/forms
  // defaults to whichever site AdminState picks first (often the newest — e.g. Northstar
  // with 0 forms), so clicking the FIRST option reads the WRONG site and false-🔴s while
  // the product is honest (the store→API→UI chain is correct per-site). Match by text.
  const sw = page.locator('button[aria-label="Select site"]');
  if (await sw.count()) {
    await sw.click();
    const mega = page.locator('button[role="option"]', { hasText: /megabyte/i }).first();
    const opt = (await mega.count()) ? mega : page.locator('button[role="option"]').first();
    await opt.waitFor({ state: 'visible', timeout: 4000 }); await opt.click(); await page.waitForTimeout(3000);
  }
  await page.waitForTimeout(1500);
  const ui = await page.evaluate((iname) => {
    const body = document.body.innerText || '';
    return {
      rows: document.querySelectorAll('tbody tr, [data-testid^="submission-"], .submission-row').length,
      showsCausal: /causal-forms-test|Causal Test/i.test(body),
      showsInjectionAsText: body.includes(iname), // the literal <script>… as visible text = escaped = safe
      scriptTagInjectedLive: !!document.querySelector('tbody script, .submission-row script, main script[data-injected]'),
    };
  }, INJ_NAME);
  out.formsUi = ui;
  await page.screenshot({ path: '/tmp/psvis/forms-causal.png', fullPage: false });

  console.log('\n=== forms API (as brian) ===\n' + JSON.stringify(apiRows, null, 2));
  console.log('\n=== /admin/forms display ===\n' + JSON.stringify(ui, null, 2));
  console.log('\n=== CONSOLE ERRORS ===\n' + (errs.length ? errs.join('\n') : '(none)'));
  const ok = submit.valid.status === 200 && submit.injection.status === 200 && apiRows.causalEmails.length >= 2 && ui.showsCausal && !xssFired && !ui.scriptTagInjectedLive && errs.length === 0;
  console.log(`\nVERDICT: ${ok ? '✅ PASS' : '🔴 CHECK'} submit=${submit.valid.status}/${submit.injection.status} apiCausal=${apiRows.causalEmails.length} uiShows=${ui.showsCausal} xssFired=${xssFired} injAsText=${ui.showsInjectionAsText} errs=${errs.length}`);
} finally { await browser.close(); }
