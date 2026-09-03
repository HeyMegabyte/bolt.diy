// Reset an errored/evicted site and poll to completion (real-browser → passes WAF).
// Env: BUILD_BEARER, SITE_ID, SLUG.
import { chromium } from 'playwright';

const BEARER = process.env.BUILD_BEARER;
const siteId = process.env.SITE_ID;
const slug = process.env.SLUG;
if (!BEARER || !siteId || !slug) { console.error('need BUILD_BEARER + SITE_ID + SLUG'); process.exit(2); }
const ORIGIN = 'https://projectsites.dev';

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(ORIGIN, { waitUntil: 'domcontentloaded', timeout: 60000 });

const reset = await page.evaluate(async ({ origin, bearer, id }) => {
  const r = await fetch(origin + '/api/sites/' + id + '/reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + bearer },
    body: '{}',
  });
  const t = await r.text();
  return { status: r.status, body: t.slice(0, 200) };
}, { origin: ORIGIN, bearer: BEARER, id: siteId });
console.log('RESET', reset.status, reset.body);

let status = 'queued';
const t0 = Date.now();
while (Date.now() - t0 < 8 * 60 * 1000) {
  await new Promise((res) => setTimeout(res, 12000));
  const w = await page.evaluate(async ({ origin, bearer, id }) => {
    const r = await fetch(origin + '/api/sites/' + id + '/workflow', { headers: { Authorization: 'Bearer ' + bearer } });
    return r.ok ? r.json() : { status: 'http_' + r.status };
  }, { origin: ORIGIN, bearer: BEARER, id: siteId });
  const d = w?.data || w || {};
  status = d.site_status || d.workflow_status || d.status || 'unknown';
  const err = d.workflow_error ? ' err=' + String(d.workflow_error).slice(0, 90) : '';
  console.log('WORKFLOW', Math.round((Date.now() - t0) / 1000) + 's', status + err);
  if (['completed', 'published', 'failed', 'error', 'errored'].includes(String(status))) break;
}
await browser.close();
process.exit(['completed', 'published'].includes(String(status)) ? 0 : 3);
