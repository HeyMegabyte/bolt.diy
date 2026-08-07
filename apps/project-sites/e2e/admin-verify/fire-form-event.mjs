#!/usr/bin/env node
/** fire-form-event.mjs — fire a FORM_START + FORM_SUBMIT via POST /api/events from a
 * real browser (origin projectsites.dev is allow-listed; real fingerprint passes Bot
 * Fight Mode — a direct curl 403s). Marker form key + sessionId let the caller find
 * them in visitor_events. Verifies the form-funnel mirror fix (POST /api/events
 * form_start/form_submit → visitor_events → /api/sites/:id/analytics/forms).
 * Creds (get-secret): BROWSERBASE_API_KEY, BROWSERBASE_PROJECT_ID. */
import { chromium } from '@playwright/test';
const BB = process.env.BROWSERBASE_API_KEY, PROJ = process.env.BROWSERBASE_PROJECT_ID;
const SESS = process.argv[2] || 'causal-form-sess-0001';
const FORM = process.argv[3] || 'causal-contact-form';
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
  const out = await page.evaluate(async ({ sess, form }) => {
    const post = async (eventType) => {
      const res = await fetch('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventId: crypto.randomUUID(),
          siteId: 'site-megabytespace-001',
          eventType,
          timestamp: Date.now(),
          sessionId: sess,
          payload: { form },
        }),
      });
      return { eventType, status: res.status, body: (await res.text()).slice(0, 80) };
    };
    const start = await post('form_start');
    const submit = await post('form_submit');
    return { start, submit };
  }, { sess: SESS, form: FORM });
  console.log('fire-form-event →', JSON.stringify(out));
  await page.waitForTimeout(5000); // let the waitUntil writes settle
} finally { await browser.close(); }
