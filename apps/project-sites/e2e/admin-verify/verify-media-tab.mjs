#!/usr/bin/env node
/** Confirm the editor's Media tab renders brian's 2 real media assets (ground truth
 *  media_assets=2). /admin/media aliases to the editor; media is its Media tab. */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const BB = process.env.BROWSERBASE_API_KEY, PROJ = process.env.BROWSERBASE_PROJECT_ID, PW = process.env.E2E_TEST_PASSWORD;
if (!BB || !PROJ || !PW) { console.log('::notice:: skipped'); process.exit(0); }
mkdirSync('/tmp/psvis', { recursive: true });
const r = await fetch('https://api.browserbase.com/v1/sessions', { method: 'POST', headers: { 'X-BB-API-Key': BB, 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: PROJ, timeout: 600 }) });
if (!r.ok) { console.log('session fail', r.status); process.exit(3); }
const { id } = await r.json();
const browser = await chromium.connectOverCDP(`wss://connect.browserbase.com?apiKey=${encodeURIComponent(BB)}&sessionId=${encodeURIComponent(id)}`);
const errors = [];
try {
  const ctx = browser.contexts()[0] ?? await browser.newContext();
  const page = ctx.pages()[0] ?? await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 110)); });
  await page.goto('https://projectsites.dev/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(7000);
  await page.evaluate(async (pw) => { const res = await fetch('/api/auth/test-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'brian@megabyte.space', password: pw }) }); const j = await res.json().catch(() => ({})); if (j?.data?.token) localStorage.setItem('ps_session', JSON.stringify({ token: j.data.token, identifier: j.data.email ?? 'brian@megabyte.space', issuedAt: Date.now() })); }, PW);
  await page.evaluate(async () => { try { const rs = await navigator.serviceWorker?.getRegistrations(); await Promise.all((rs ?? []).map((x) => x.unregister())); } catch {} });
  await page.goto('https://projectsites.dev/admin/editor', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(4000);
  // Click the Media tab (top-right of the editor).
  let clicked = false;
  for (const sel of ['button:has-text("Media")', '[role="tab"]:has-text("Media")', 'a:has-text("Media")', 'text=Media']) {
    try { const el = page.locator(sel).first(); if (await el.count()) { await el.click({ timeout: 4000 }); clicked = true; break; } } catch {}
  }
  await page.waitForTimeout(7000); // media library loads /api/media/assets
  const info = await page.evaluate(() => {
    const items = document.querySelectorAll('[data-testid*="media"], .media-card, .asset-card, .media-item, .media-tile, figure, img[src*="/api/media/"]').length;
    const body = document.body.innerText || '';
    return { mediaItems: items, hasEmpty: /no media|no assets|nothing here|empty|upload your first/i.test(body), bodySnippet: body.replace(/\s+/g, ' ').slice(0, 200) };
  });
  await page.screenshot({ path: '/tmp/psvis/media-tab.png', fullPage: false });
  console.log(JSON.stringify({ tabClicked: clicked, ...info, consoleErrors: errors, verdict: info.mediaItems >= 2 ? `✅ Media tab shows ${info.mediaItems} items` : info.mediaItems > 0 ? `~ shows ${info.mediaItems}` : '🔴 no media items rendered' }, null, 2));
} finally { await browser.close(); }
