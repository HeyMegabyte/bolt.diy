// completeness-stub-scan.mjs — durable COMPLETENESS gate (dimensions 5 EDGE STATES + 7 EVERY
// CONTROL REAL). For every REAL render-section (SSOT: admin-contract.mjs, excluding aliases +
// sysAdmin-guarded sections the e2e session can't reach), assert the LIVE prod surface shows:
//   • NO stub markers ("coming soon"/"todo"/"placeholder"/"lorem"/"mock data"/"under construction")
//     — except the documented adapter-less allowlist (mcp + apps show "Coming soon" by design,
//     per the MCP_AVAILABLE SSOT), and
//   • NO dead links (href="#" / empty / javascript:void) and NO blank/error-boundary section.
//
// This is the standing regression guard for the mature admin plateau (fire-13, 2026-09-06):
// a scout of all 23 sections found ZERO genuine dead controls — every apparent flag was
// by-design (seo/domains/webhooks are alias folds → settings/features; leads+feature-flags
// bounce via sysAdminGuard; mcp/apps "Coming soon" = adapter-less; Save/Prev/Send-invite are
// disabled-until-valid, NOT dead). This gate locks that in: it PASSES now and FAILS the moment
// a real section regresses to a stub/dead-control/blank. Disabled-until-valid buttons are NOT
// flagged (conventional; disabled ≠ dead — validator-precision).
//
// Fail-open (conditional-ci-gates): E2E_API_KEY unset ⇒ ::notice:: + exit 0.
// Usage: E2E_API_KEY=$(get-secret E2E_API_KEY) node e2e/admin-verify/completeness-stub-scan.mjs
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const req = createRequire(resolve(__dirname, '../../frontend/'));
const { chromium } = req('playwright');

const KEY = process.env.E2E_API_KEY;
if (!KEY) { console.log('::notice:: completeness-stub-scan skipped — E2E_API_KEY unset'); process.exit(0); }
const ORIGIN = process.env.ORIGIN || 'https://projectsites.dev';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';

// The vetted top-level admin sections (mirrors admin-surf-audit.mjs' curated list). Alias folds
// (seo→features, domains/webhooks→settings) + sysAdmin bounces (leads→features) harmlessly
// resolve to their COMPLETE target pages, so a stub scan over this set never false-flags them.
const SECTIONS = (process.env.SECTIONS || 'dashboard,sites,forms,analytics,snapshots,billing,audit,docs,settings,mcp,apps,social,domains,seo,site-features,team,webhooks,leads,deliverability,voice,user,api-tokens,logs').split(',');
// Documented "Coming soon" allowlist — adapter-less MCP/apps providers (MCP_AVAILABLE SSOT).
const COMING_SOON_OK = new Set(['mcp', 'apps']);

// Unambiguous incomplete-surface markers. NOT "example.com" (legit in placeholders/copy) and
// NOT "sample" alone (legit: "sample business"). Each is something a SHIPPED real section
// should never render to a user.
const STUB = /coming soon|not implemented|\btodo\b|\bfixme\b|placeholder text|lorem ipsum|mock data|dummy data|under construction|feature is being built|not yet implemented/i;
const SOFT_404 = /this admin page does(?:n['’]t| not) exist/i;

const browser = await chromium.launch();
const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
const page = await ctx.newPage();
await page.goto(ORIGIN + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.evaluate((k) => localStorage.setItem('ps_session', JSON.stringify({ token: k, identifier: 'e2e@megabyte.space', issuedAt: Date.now() })), KEY);

const rows = [];
let fails = 0;
for (const s of SECTIONS) {
  try {
    await page.goto(`${ORIGIN}/admin/${s}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(1600);
    const r = await page.evaluate(({ stubSrc, s404Src }) => {
      const STUB = new RegExp(stubSrc, 'i');
      const S404 = new RegExp(s404Src, 'i');
      const main = document.querySelector('app-section-error-boundary') || document.body;
      const txt = (main.innerText || '');
      const stubHits = [...new Set((txt.match(new RegExp(stubSrc, 'ig')) || []))].slice(0, 4);
      const visible = (el) => { const r = el.getBoundingClientRect(); return el.offsetParent != null && r.width > 0 && r.height > 0; };
      const deadLinks = [...main.querySelectorAll('a[href]')].filter(visible)
        .filter((el) => /^(#|javascript:void|)$/i.test((el.getAttribute('href') || '').trim()))
        .map((el) => (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 28)).filter(Boolean).slice(0, 6);
      return { stubHits, deadLinks, len: txt.trim().length, soft404: S404.test(txt) };
    }, { stubSrc: STUB.source, s404Src: SOFT_404.source });

    const badStub = r.stubHits.length && !COMING_SOON_OK.has(s);
    const blank = r.len < 60;
    const bad = !!badStub || r.deadLinks.length > 0 || blank || r.soft404;
    if (bad) fails++;
    rows.push({ s, bad, ...r, allowed: r.stubHits.length && COMING_SOON_OK.has(s) });
  } catch (e) {
    rows.push({ s, bad: true, err: String(e).slice(0, 80) });
    fails++;
  }
}
await browser.close();

for (const r of rows) {
  if (r.err) { console.log(`  ✗  ${r.s.padEnd(14)} error: ${r.err}`); continue; }
  const notes = [];
  if (r.stubHits?.length) notes.push(`${r.allowed ? 'coming-soon(allowed)' : 'STUB'}{${r.stubHits.join('|')}}`);
  if (r.deadLinks?.length) notes.push(`DEAD-LINK{${r.deadLinks.join('|')}}`);
  if (r.len < 60) notes.push(`BLANK(${r.len})`);
  if (r.soft404) notes.push('SOFT-404');
  console.log(`  ${r.bad ? '✗' : '✓'}  ${r.s.padEnd(14)} ${notes.join('  ') || 'complete'}`);
}
console.log(
  fails
    ? `VERDICT: ❌ FAIL — ${fails}/${rows.length} section(s) show a stub / dead-link / blank / soft-404 (incomplete surface).`
    : `VERDICT: ✅ PASS — ${rows.length}/${rows.length} real sections complete (no stub / dead-link / blank; adapter-less "Coming soon" allowed on mcp+apps).`,
);
process.exit(fails ? 1 : 0);
