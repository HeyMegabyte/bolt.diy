#!/usr/bin/env node
/**
 * verify-social-posts.mjs — focused live verify (as brian, real browser) for the
 * Pulse Social posts crash-on-populate fix + the apps-instances scanner-route gap.
 *
 * TECHNICAL: authed GET /api/social/posts?site_id=… returns 5 fully-shaped posts
 *   (each with a `platforms[]` array + `media[]` + `hashtags[]` — the worker used to
 *   return raw rows, crashing the card on `post.media.length`).
 * VISUAL: /admin/social → select site → Drafts/Queue/Sent tab count badges read 1/2/2,
 *   each list tab renders post cards, ZERO console errors / crashes; then
 *   /admin/apps/instances renders the 3 seeded instances.
 *
 * Creds (get-secret): BROWSERBASE_API_KEY, BROWSERBASE_PROJECT_ID, E2E_TEST_PASSWORD.
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const BB = process.env.BROWSERBASE_API_KEY, PROJ = process.env.BROWSERBASE_PROJECT_ID, PW = process.env.E2E_TEST_PASSWORD;
if (!BB || !PROJ || !PW) { console.log('::notice:: skipped — creds unset'); process.exit(0); }
mkdirSync('/tmp/psvis', { recursive: true });
const SITE = 'site-megabytespace-001';

const r = await fetch('https://api.browserbase.com/v1/sessions', { method: 'POST', headers: { 'X-BB-API-Key': BB, 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: PROJ, timeout: 600 }) });
if (!r.ok) { console.log('session create failed', r.status); process.exit(3); }
const { id } = await r.json();
const browser = await chromium.connectOverCDP(`wss://connect.browserbase.com?apiKey=${encodeURIComponent(BB)}&sessionId=${encodeURIComponent(id)}`);
let cur = 'boot';
const errs = [];
try {
  const ctx = browser.contexts()[0] ?? await browser.newContext();
  const page = ctx.pages()[0] ?? await ctx.newPage();
  page.on('console', (m) => { const t = m.type(); const x = m.text(); if (/Failed to load resource/i.test(x)) return; if (t === 'error' || (t === 'warning' && /ran into a problem|GlobalErrorHandler|Unhandled|ExpressionChanged/i.test(x))) errs.push(`[${cur}][${t}] ${x.slice(0, 130)}`); });
  page.on('pageerror', (e) => errs.push(`[${cur}][pageerror] ${(e.message || String(e)).slice(0, 130)}`));

  await page.goto('https://projectsites.dev/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(6000);
  await page.evaluate(async (pw) => { const res = await fetch('/api/auth/test-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'brian@megabyte.space', password: pw }) }); const j = await res.json().catch(() => ({})); if (j?.data?.token) localStorage.setItem('ps_session', JSON.stringify({ token: j.data.token, identifier: j.data.email ?? 'brian@megabyte.space', issuedAt: Date.now() })); }, PW);

  // ── TECHNICAL: authed GET /api/social/posts as brian ──
  cur = 'api';
  const api = await page.evaluate(async (site) => {
    const tok = JSON.parse(localStorage.getItem('ps_session') || '{}').token;
    const res = await fetch(`/api/social/posts?site_id=${site}`, { headers: { Authorization: `Bearer ${tok}` } });
    const j = await res.json().catch(() => ({}));
    const posts = j?.data ?? [];
    return {
      status: res.status,
      count: posts.length,
      byStatus: posts.reduce((a, p) => ((a[p.status] = (a[p.status] || 0) + 1), a), {}),
      allHavePlatformsArray: posts.every((p) => Array.isArray(p.platforms)),
      allHaveMediaArray: posts.every((p) => Array.isArray(p.media)),
      allHaveHashtagsArray: posts.every((p) => Array.isArray(p.hashtags)),
      samplePlatforms: posts.slice(0, 5).map((p) => `${p.status}:${(p.platforms || []).join('+') || 'none'}`),
    };
  }, SITE);
  console.log('\n=== TECHNICAL — GET /api/social/posts (as brian) ===');
  console.log(JSON.stringify(api, null, 2));

  // ── VISUAL: /admin/social → select site → click each list tab ──
  cur = 'social';
  await page.goto('https://projectsites.dev/admin/social', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(4500);
  try {
    const sw = page.locator('button[aria-label="Select site"]');
    if (await sw.count()) { await sw.click(); const opt = page.locator('button[role="option"]').first(); await opt.waitFor({ state: 'visible', timeout: 4000 }); await opt.click(); await page.waitForTimeout(3500); }
  } catch {}
  await page.waitForTimeout(1500);

  const tabCounts = await page.evaluate(() => Array.from(document.querySelectorAll('.tab')).map((t) => (t.textContent || '').replace(/\s+/g, ' ').trim()));
  const tabResults = {};
  for (const [label, tab] of [['drafts', 'Drafts'], ['queue', 'Queue'], ['sent', 'Sent']]) {
    cur = `social:${label}`;
    try {
      await page.locator(`button.tab:has-text("${tab}")`).first().click();
      await page.waitForTimeout(2000);
      const cards = await page.locator('article.post-card').count();
      const empty = await page.locator('.empty-state').count();
      tabResults[label] = { cards, empty };
      await page.screenshot({ path: `/tmp/psvis/social-${label}.png`, fullPage: false });
    } catch (e) { tabResults[label] = { FAIL: String(e).slice(0, 80) }; }
  }
  console.log('\n=== VISUAL — /admin/social tabs ===');
  console.log('tab badges:', JSON.stringify(tabCounts));
  console.log('tab card counts:', JSON.stringify(tabResults));

  // ── /admin/apps/instances → 3 seeded instances ──
  cur = 'apps-instances';
  await page.goto('https://projectsites.dev/admin/apps/instances', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(4500);
  const appsInfo = await page.evaluate(() => {
    const body = document.body.innerText || '';
    return {
      mentions: ['listmonk', 'plane', 'chatwoot'].filter((s) => new RegExp(s, 'i').test(body)),
      cardish: document.querySelectorAll('[data-testid^="apps-instance-"], .instance-card, article').length,
      mainLen: (document.querySelector('main')?.innerText || body).trim().length,
    };
  });
  await page.screenshot({ path: '/tmp/psvis/apps-instances.png', fullPage: false });
  console.log('\n=== /admin/apps/instances ===');
  console.log(JSON.stringify(appsInfo, null, 2));

  // ── verdict ──
  console.log('\n=== CONSOLE ERRORS ===');
  console.log(errs.length ? errs.join('\n') : '(none)');
  const ok = api.status === 200 && api.count === 5 && api.allHavePlatformsArray && api.allHaveMediaArray &&
    (tabResults.drafts?.cards >= 1) && (tabResults.queue?.cards >= 2) && (tabResults.sent?.cards >= 2) &&
    appsInfo.mentions.length === 3 && errs.length === 0;
  console.log(`\nVERDICT: ${ok ? '✅ PASS' : '🔴 CHECK'} (api5=${api.count === 5}, shaped=${api.allHavePlatformsArray}, drafts=${tabResults.drafts?.cards}, queue=${tabResults.queue?.cards}, sent=${tabResults.sent?.cards}, apps=${appsInfo.mentions.length}, errs=${errs.length})`);
} finally { await browser.close(); }
