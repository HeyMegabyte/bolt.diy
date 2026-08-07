#!/usr/bin/env node
/** fire-contact.mjs — submit a CONTACT FORM via POST /api/contact-form/:slug from a
 * real browser (origin projectsites.dev is allow-listed; real fingerprint passes Bot
 * Fight Mode — a direct curl 403s). Unique marker name lets the caller find the row
 * in the `contacts` D1 table. Verifies the durable-persist fix (contact-form →
 * contacts row → admin analytics contacts count). Arg1: slug (default megabytespace),
 * arg2: marker name. Creds (get-secret): BROWSERBASE_API_KEY, BROWSERBASE_PROJECT_ID. */
import { chromium } from '@playwright/test';
const BB = process.env.BROWSERBASE_API_KEY, PROJ = process.env.BROWSERBASE_PROJECT_ID;
const SLUG = process.argv[2] || 'megabytespace';
const MARK = process.argv[3] || 'Causal Contact Test';
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
  const out = await page.evaluate(async ({ slug, mark }) => {
    const res = await fetch(`/api/contact-form/${slug}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: mark,
        email: 'causal-contact@example.com',
        phone: '+16025550142',
        message: `Causal contact-form persistence test — ${mark}. This message is at least ten chars.`,
      }),
    });
    return { status: res.status, body: (await res.text()).slice(0, 140) };
  }, { slug: SLUG, mark: MARK });
  console.log('fire-contact →', JSON.stringify(out));
  await page.waitForTimeout(5000); // let the durable write settle
} finally { await browser.close(); }
