// admin-surf-audit.mjs — fast broad sweep of EVERY admin section (session-seeded from
// E2E_API_KEY, never inline). Per section records: landed URL (detects 403/redirects),
// console errors (GA/beacon/posthog/CF-bot noise filtered), error-boundary crash text,
// and whether real content rendered (root innerHTML length). No axe → fast (~load only),
// a different lens than surf-a11y-gap. Exit 1 on any console error / boundary crash /
// blank section. Usage: E2E_API_KEY=… node e2e/admin-verify/admin-surf-audit.mjs
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const req = createRequire(resolve(__dirname, '../../frontend/'));
const { chromium } = req('playwright');

const KEY = process.env.E2E_API_KEY;
if (!KEY) { console.error('E2E_API_KEY env required'); process.exit(2); }
const ORIGIN = process.env.ORIGIN || 'https://projectsites.dev';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';

const SECTIONS = [
  'dashboard', 'sites', 'forms', 'analytics', 'snapshots', 'billing', 'audit', 'docs',
  'settings', 'mcp', 'apps', 'social', 'domains', 'seo', 'site-features', 'team',
  'webhooks', 'media', 'leads', 'deliverability', 'voice', 'user-settings', 'api-tokens',
  'env-vars', 'logs',
];

// Console noise we intentionally ignore (third-party beacons + CF bot challenge on
// analytics ingest — documented as healthy in the loop memories).
const IGNORE = /google-analytics|googletagmanager|posthog|\/ingest|doubleclick|sentry|clarity|hotjar|cf-|challenge|beacon|Failed to load resource.*(analytics|ingest|posthog)/i;

const browser = await chromium.launch();
const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
const page = await ctx.newPage();

await page.goto(ORIGIN + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.evaluate((k) => {
  localStorage.setItem('ps_session', JSON.stringify({ token: k, identifier: 'e2e@megabyte.space', issuedAt: Date.now() }));
}, KEY);

const rows = [];
let problems = 0;

for (const s of SECTIONS) {
  const errors = [];
  const onErr = (m) => { const t = m.text(); if (m.type() === 'error' && !IGNORE.test(t)) errors.push(t.slice(0, 120)); };
  const onPageErr = (e) => { const t = String(e); if (!IGNORE.test(t)) errors.push('pageerror: ' + t.slice(0, 120)); };
  page.on('console', onErr);
  page.on('pageerror', onPageErr);
  try {
    await page.goto(`${ORIGIN}/admin/${s}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2600);
    const info = await page.evaluate(() => {
      const root = document.querySelector('app-root, #root, body');
      const txt = document.body.innerText || '';
      const boundary = /something went wrong|section (failed|crashed|error)|reset this section|an error occurred/i.test(txt);
      return {
        url: location.pathname + (location.hash || ''),
        len: (root?.innerHTML || '').length,
        textLen: txt.trim().length,
        boundary,
      };
    });
    const blank = info.textLen < 40;
    const bad = errors.length > 0 || info.boundary || blank;
    if (bad) problems++;
    const flags = [
      errors.length ? `${errors.length} console-err` : null,
      info.boundary ? 'ERROR-BOUNDARY' : null,
      blank ? 'BLANK' : null,
    ].filter(Boolean).join(', ');
    rows.push(`  ${bad ? '✗' : '✓'} /admin/${s}`.padEnd(28) + `→ ${info.url.padEnd(26)} ${bad ? flags : 'ok (' + info.textLen + ' chars)'}`);
    if (errors.length) for (const e of errors.slice(0, 3)) rows.push(`        · ${e}`);
  } catch (e) {
    problems++;
    rows.push(`  ! /admin/${s} nav error: ${String(e).slice(0, 80)}`);
  }
  page.off('console', onErr);
  page.off('pageerror', onPageErr);
}

console.log(`━━ admin surf audit: ${ORIGIN} → ${problems === 0 ? 'CLEAN' : problems + ' section(s) with issues'} ━━`);
for (const r of rows) console.log(r);
await browser.close();
process.exit(problems === 0 ? 0 : 1);
