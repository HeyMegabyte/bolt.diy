#!/usr/bin/env node
/** visit-site.mjs — real-browser visit to a hosted site (fires the server-side
 * recordPageviewFromRequest pageview + the client beacon). Used by the analytics
 * causal test: baseline visitor_events count → visit → recount. Arg: the URL. */
import { chromium } from '@playwright/test';
const BB = process.env.BROWSERBASE_API_KEY, PROJ = process.env.BROWSERBASE_PROJECT_ID;
const URL = process.argv[2] || 'https://megabytespace.projectsites.dev/';
if (!BB || !PROJ) { console.log('::notice:: skipped — creds unset'); process.exit(0); }
const r = await fetch('https://api.browserbase.com/v1/sessions', { method: 'POST', headers: { 'X-BB-API-Key': BB, 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: PROJ, timeout: 300 }) });
if (!r.ok) { console.log('session create failed', r.status); process.exit(3); }
const { id } = await r.json();
const browser = await chromium.connectOverCDP(`wss://connect.browserbase.com?apiKey=${encodeURIComponent(BB)}&sessionId=${encodeURIComponent(id)}`);
try {
  const ctx = browser.contexts()[0] ?? await browser.newContext();
  const page = ctx.pages()[0] ?? await ctx.newPage();
  const res = await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  console.log(`visited ${URL} → status ${res?.status()}`);
  await page.waitForTimeout(3000);
  // second page to fire another pageview if the site has internal links
  await page.goto(URL + '?psvisit=' + '2', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(4000); // let the beacon + server-side write settle
  console.log('done');
} finally { await browser.close(); }
