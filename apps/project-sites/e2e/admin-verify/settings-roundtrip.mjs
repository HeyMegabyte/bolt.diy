#!/usr/bin/env node
/**
 * settings-roundtrip.mjs — TECHNICAL LIVE verification (P0.54) that the
 * Settings → General brand + locale fields (`brand_primary`, `brand_accent`,
 * `timezone`, `default_locale`) now ROUND-TRIP through
 * `PUT/GET /api/sites/:siteId/ai-settings` in brian's real account.
 *
 * Before this fire the worker's PUT allow-list dropped these 4 fields and the
 * GET never returned them → the FE showed "Saved" then the values vanished on
 * reload (a lying-UI). Migration 0611 added the D1 columns + ai_admin.ts now
 * allows + returns them. This probe proves the fix end-to-end on PROD.
 *
 * Clobber-safe: GET the originals → PUT distinct test values → GET + assert →
 * PUT the originals back. Runs an authed in-browser fetch via Browserbase (a
 * direct curl PUT hits the CF managed challenge; an in-browser fetch after the
 * page solves the challenge does not). ⚠️ seed `ps_session.identifier` (not
 * `email`) — AuthService.email reads `.identifier`.
 *
 * Creds (get-secret): BROWSERBASE_API_KEY, BROWSERBASE_PROJECT_ID,
 * E2E_TEST_PASSWORD. Exits 0 (skip) if any is unset — never fail-closed.
 */
import { chromium } from '@playwright/test';

const BB = process.env.BROWSERBASE_API_KEY;
const PROJ = process.env.BROWSERBASE_PROJECT_ID;
const PW = process.env.E2E_TEST_PASSWORD;
if (!BB || !PROJ || !PW) {
  console.log('::notice:: settings-roundtrip skipped — BROWSERBASE_API_KEY / BROWSERBASE_PROJECT_ID / E2E_TEST_PASSWORD unset');
  process.exit(0);
}

const SITE = process.argv[2] || 'site-megabytespace-001';
const EP = `/api/sites/${SITE}/ai-settings`;
const FIELDS = ['brand_primary', 'brand_accent', 'timezone', 'default_locale'];
const TEST = { brand_primary: '#112233', brand_accent: '#445566', timezone: 'America/New_York', default_locale: 'en-US' };

const r = await fetch('https://api.browserbase.com/v1/sessions', {
  method: 'POST', headers: { 'X-BB-API-Key': BB, 'Content-Type': 'application/json' },
  body: JSON.stringify({ projectId: PROJ, timeout: 600 }),
});
if (!r.ok) { console.log('session create failed', r.status); process.exit(3); }
const { id } = await r.json();
const browser = await chromium.connectOverCDP(`wss://connect.browserbase.com?apiKey=${encodeURIComponent(BB)}&sessionId=${encodeURIComponent(id)}`);
let exitCode = 0;
try {
  const ctx = browser.contexts()[0] ?? await browser.newContext();
  const page = ctx.pages()[0] ?? await ctx.newPage();
  await page.goto('https://projectsites.dev/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(7000); // CF managed-challenge solve

  const login = await page.evaluate(async (pw) => {
    const res = await fetch('/api/auth/test-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'brian@megabyte.space', password: pw }) });
    const j = await res.json().catch(() => ({}));
    const token = j?.data?.token ?? null;
    if (token) { try { localStorage.setItem('ps_session', JSON.stringify({ token, identifier: j?.data?.email ?? 'brian@megabyte.space', issuedAt: Date.now() })); } catch { /* private mode */ } }
    return { status: res.status, token };
  }, PW);
  if (!login.token) { console.log(JSON.stringify({ ok: false, stage: 'login', login })); process.exit(4); }
  const token = login.token;

  const call = (method, body) => page.evaluate(async ({ ep, method, body, token }) => {
    const res = await fetch(ep, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  }, { ep: EP, method, body, token });

  // 1) GET originals (clobber-safe capture)
  const before = await call('GET', null);
  const origData = before.body?.data ?? {};
  const orig = Object.fromEntries(FIELDS.map((f) => [f, origData[f] ?? null]));

  // 2) PUT distinct test values
  const put = await call('PUT', TEST);

  // 3) GET + assert the 4 fields round-trip
  const after = await call('GET', null);
  const got = after.body?.data ?? {};
  const roundtrip = FIELDS.every((f) => got[f] === TEST[f]);

  // 4) restore originals
  const restore = await call('PUT', orig);

  const report = {
    ok: before.status === 200 && put.status === 200 && after.status === 200 && roundtrip,
    site: SITE,
    getStatus: before.status,
    putStatus: put.status,
    verifyStatus: after.status,
    restoreStatus: restore.status,
    original: orig,
    wrote: TEST,
    readBack: Object.fromEntries(FIELDS.map((f) => [f, got[f] ?? null])),
    roundtrip,
  };
  console.log(JSON.stringify(report, null, 2));
  exitCode = report.ok ? 0 : 5;
} finally {
  await browser.close();
}
process.exit(exitCode);
