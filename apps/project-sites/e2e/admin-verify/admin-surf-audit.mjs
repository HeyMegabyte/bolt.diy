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
const { default: AxeBuilder } = req('@axe-core/playwright');

const KEY = process.env.E2E_API_KEY;
if (!KEY) { console.error('E2E_API_KEY env required'); process.exit(2); }
const ORIGIN = process.env.ORIGIN || 'https://projectsites.dev';
// Viewport is configurable (VIEWPORT=390 for the mobile pass); default desktop.
const VW = parseInt(process.env.VIEWPORT || '1280', 10);
const VH = VW <= 480 ? 844 : 900;
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
const ctx = await browser.newContext({ userAgent: UA, viewport: { width: VW, height: VH }, serviceWorkers: 'block' });
const page = await ctx.newPage();

await page.goto(ORIGIN + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.evaluate((k) => {
  localStorage.setItem('ps_session', JSON.stringify({ token: k, identifier: 'e2e@megabyte.space', issuedAt: Date.now() }));
}, KEY);

const rows = [];
let problems = 0;
let bpTotal = 0; // axe best-practice (region/heading-order/landmark) — advisory, tracked not gated

for (const s of SECTIONS) {
  const errors = [];
  const onErr = (m) => { const t = m.text(); if (m.type() === 'error' && !IGNORE.test(t)) errors.push(t.slice(0, 120)); };
  const onPageErr = (e) => { const t = String(e); if (!IGNORE.test(t)) errors.push('pageerror: ' + t.slice(0, 120)); };
  page.on('console', onErr);
  page.on('pageerror', onPageErr);
  try {
    await page.goto(`${ORIGIN}/admin/${s}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(1500);
    // Wait for loading skeletons/spinners to clear so axe evaluates the SETTLED state —
    // a mid-load skeleton/placeholder transiently fails contrast → flaky false positives
    // (validator-precision-discipline: a guard that cries wolf is worse than none).
    await page
      .waitForFunction(
        () => !document.querySelector('[aria-busy="true"], .animate-pulse, .skeleton, .loading-skeleton, [data-loading="true"]'),
        { timeout: 5000 },
      )
      .catch(() => {});
    await page.waitForTimeout(900);
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
    // axe at the current viewport. WCAG critical/serious drives the pass/fail gate
    // (unchanged). best-practice (region/heading-order/landmark) — which validate-site
    // + a WCAG-only pass both MISS — is split out + tracked SEPARATELY: reported per
    // section + summarized, but ADVISORY (doesn't fail the audit) per the audit-arc
    // Detect→Surface→Gate ladder. It's what caught the /admin region + heading-order
    // regressions the WCAG-only audit was blind to (commits b7740b28f / f8b9a7db5).
    let axeSerious = [];
    let axeBp = [];
    try {
      const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
      const isW = (v) => v.tags.some((t) => /^wcag/.test(t));
      const wcSev = (r) => r.violations.filter((v) => isW(v) && (v.impact === 'critical' || v.impact === 'serious'));
      const bpSev = (r) => r.violations.filter((v) => !isW(v) && (v.impact === 'critical' || v.impact === 'serious' || v.id === 'region' || v.id === 'heading-order' || v.id === 'landmark-unique'));
      const runAxe = async () => { const r = await new AxeBuilder({ page }).withTags([...TAGS, 'best-practice']).analyze(); return [wcSev(r), bpSev(r)]; };
      [axeSerious, axeBp] = await runAxe();
      // Recheck-on-violation (same page, longer settle): a load/enter-animation transient
      // clears; a persistent violation stays. Kills flaky reds on slow CI runners.
      if (axeSerious.length + axeBp.length > 0) {
        await page.waitForTimeout(2500);
        [axeSerious, axeBp] = await runAxe();
      }
    } catch { /* axe injection can fail on a redirected shell — treat as no data */ }
    bpTotal += axeBp.length;
    const blank = info.textLen < 40;
    const bad = errors.length > 0 || info.boundary || blank || axeSerious.length > 0;
    if (bad) problems++;
    const flags = [
      errors.length ? `${errors.length} console-err` : null,
      info.boundary ? 'ERROR-BOUNDARY' : null,
      blank ? 'BLANK' : null,
      axeSerious.length ? `${axeSerious.length} axe` : null,
    ].filter(Boolean).join(', ');
    const bpFlag = axeBp.length ? `  [bp: ${axeBp.map((v) => `${v.id}(${v.nodes.length})`).join('+')}]` : '';
    rows.push(`  ${bad ? '✗' : '✓'} /admin/${s}`.padEnd(28) + `→ ${info.url.padEnd(26)} ${bad ? flags : 'ok (' + info.textLen + ' chars)'}${bpFlag}`);
    if (errors.length) for (const e of errors.slice(0, 3)) rows.push(`        · ${e}`);
    for (const v of axeSerious) rows.push(`        [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length}) e.g. ${(v.nodes[0]?.target || []).join(' ')} — ${(v.nodes[0]?.html || '').slice(0, 80)}`);
  } catch (e) {
    problems++;
    rows.push(`  ! /admin/${s} nav error: ${String(e).slice(0, 80)}`);
  }
  page.off('console', onErr);
  page.off('pageerror', onPageErr);
}

console.log(`━━ admin surf audit @${VW}px (a11y+console+boundary+content): ${ORIGIN} → ${problems === 0 ? 'CLEAN' : problems + ' section(s) with issues'} ━━`);
if (bpTotal > 0) console.log(`  ⚠ advisory: ${bpTotal} best-practice a11y finding(s) (region/heading-order/landmark) — tracked, not gated; promote to a hard fail once stable at 0`);
for (const r of rows) console.log(r);
await browser.close();
process.exit(problems === 0 ? 0 : 1);
