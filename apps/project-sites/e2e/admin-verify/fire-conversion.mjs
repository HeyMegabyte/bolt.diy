#!/usr/bin/env node
/** fire-conversion.mjs — fire a CONVERSION event via POST /api/events from a real
 * browser (origin projectsites.dev is allow-listed; real fingerprint passes Bot Fight
 * Mode — a direct curl 403s). Marker sessionId lets the caller find it in visitor_events.
 * Verifies the conversion-mirror fix (POST /api/events conversion → visitor_events).
 * Creds (get-secret): BROWSERBASE_API_KEY, BROWSERBASE_PROJECT_ID. */
import { chromium } from '@playwright/test';
const BB = process.env.BROWSERBASE_API_KEY, PROJ = process.env.BROWSERBASE_PROJECT_ID;
const SESS = process.argv[2] || 'causal-conv-sess-0001';
if (!BB || !PROJ) { console.log('::notice:: skipped — creds unset'); process.exit(0); }
const r = await fetch('https://api.browserbase.com/v1/sessions', { method: 'POST', headers: { 'X-BB-API-Key': BB, 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: PROJ, timeout: 300 }) });
if (!r.ok) { console.log('session create failed', r.status); process.exit(3); }
const { id } = await r.json();
const browser = await chromium.connectOverCDP(`wss://connect.browserbase.com?apiKey=${encodeURIComponent(BB)}&sessionId=${encodeURIComponent(id)}`);
try {
  const ctx = browser.contexts()[0] ?? await browser.newContext();
  const page = ctx.pages()[0] ?? await ctx.newPage();
  await page.goto('https://projectsites.dev/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);
  const out = await page.evaluate(async (sess) => {
    const res = await fetch('/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId: crypto.randomUUID(),
        siteId: 'site-megabytespace-001',
        eventType: 'conversion',
        timestamp: Date.now(),
        sessionId: sess,
        payload: { kind: 'call', section: 'hero', href: 'tel:+16025550199' },
      }),
    });
    return { status: res.status, body: (await res.text()).slice(0, 120) };
  }, SESS);
  console.log('fire-conversion →', JSON.stringify(out));
  await page.waitForTimeout(5000); // let the waitUntil write settle
} finally { await browser.close(); }
