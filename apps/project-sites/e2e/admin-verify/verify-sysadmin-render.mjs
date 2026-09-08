// verify-sysadmin-render.mjs — RENDER-resilience of the FOUR sysAdmin-gated sections that
// `admin-surf-audit.mjs` is STRUCTURALLY BLIND to. Surf-audit seeds `identifier:'e2e@…'`
// (not a super-admin email), so the CLIENT `sysAdminGuard` (`isSysAdminEmail(auth.email())`)
// BOUNCES /admin/{leads,feature-flags,system-services,super-admin} to /admin/site-features —
// the section component NEVER renders, so a crash inside it is invisible (exactly how AL-155's
// `/admin/leads` error-boundary crash on `lead.socials[network]` hid from every surf-audit fire).
//
// This probe seeds a SUPER-ADMIN identity (`identifier:'brian@megabyte.space'` → `isSysAdminEmail`
// → true, the same pattern the admin-*-journey specs use) so the client guard ADMITS and the
// component MOUNTS. It uses the ordinary E2E_API_KEY token, whose server-side user is NOT
// super-admin, so the section's data API correctly 403s — which is the point: it asserts each
// section DEGRADES GRACEFULLY under that 403 (renders its shell + a graceful restricted/error/
// empty state), never an error-boundary crash / blank / uncaught console error.
//
// Complements super-admin-probe.mjs (Browserbase real-brian, POPULATED data + mutation contracts,
// creds-gated) — this one needs no Browserbase and runs every pass, closing the render gap the
// `e2e-key-is-not-brians-account` memory flagged. Exit 1 on any bounce / crash / blank / real
// console error. Usage: E2E_API_KEY=… node e2e/admin-verify/verify-sysadmin-render.mjs
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const req = createRequire(resolve(__dirname, '../../frontend/'));
// playwright-core (not playwright) — reliably hoisted after clean npm ci (AL-144).
const { chromium } = req('playwright-core');

const KEY = process.env.E2E_API_KEY;
if (!KEY) { console.error('E2E_API_KEY env required'); process.exit(2); }
const ORIGIN = process.env.ORIGIN || 'https://projectsites.dev';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';

// The four sysAdmin-gated sections (app.routes.ts + sysAdminGuard). Fallback = the client
// guard's redirect target; landing there means the section was BOUNCED (guard/render regression).
const SECTIONS = ['leads', 'feature-flags', 'system-services', 'super-admin'];
const BOUNCE_TARGET = '/admin/site-features';

// Console noise we ignore: third-party beacons + CF bot challenge (documented healthy), AND the
// EXPECTED 403/Forbidden — the E2E token is not a server-side super-admin, so the sysAdmin data
// APIs correctly deny; a 403 is the honest server response, not a render defect.
const IGNORE = /google-analytics|googletagmanager|posthog|\/ingest|doubleclick|sentry|clarity|hotjar|cf-|challenge|beacon|favicon|Failed to load resource|\b403\b|Forbidden|Unauthorized|\b401\b/i;
// An error-boundary crash card (SectionErrorBoundaryComponent) — the AL-155 signature.
const BOUNDARY = /Something went wrong|section (?:failed|crashed)|error boundary|reset this section/i;

const browser = await chromium.launch();
const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
const page = await ctx.newPage();

await page.goto(ORIGIN + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
// Seed a SUPER-ADMIN identity so the client sysAdminGuard admits (journey-spec pattern).
await page.evaluate((k) => {
  localStorage.setItem('ps_session', JSON.stringify({ token: k, identifier: 'brian@megabyte.space', issuedAt: Date.now() }));
}, KEY);

let problems = 0;
const rows = [];
for (const s of SECTIONS) {
  const errors = [];
  const onErr = (m) => { const t = m.text(); if (m.type() === 'error' && !IGNORE.test(t)) errors.push(t.slice(0, 120)); };
  const onPageErr = (e) => { const t = String(e); if (!IGNORE.test(t)) errors.push('pageerror: ' + t.slice(0, 120)); };
  page.on('console', onErr);
  page.on('pageerror', onPageErr);
  try {
    await page.goto(`${ORIGIN}/admin/${s}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.locator('app-admin, [data-cockpit="v2"]').first().waitFor({ timeout: 35000 }).catch(() => {});
    await page.waitForTimeout(3000);
    const landed = new URL(page.url()).pathname;
    const bounced = landed.startsWith(BOUNCE_TARGET) || (landed !== `/admin/${s}`);
    const main = page.locator('main, app-admin').first();
    const body = (await main.innerText().catch(() => '')).trim();
    const boundaryCrash = BOUNDARY.test(body);
    const heading = (await page.locator('h1, h2, [class*="section-h"]').first().innerText().catch(() => '')).trim();
    const fails = [];
    if (bounced) fails.push(`bounced→${landed} (client guard didn't admit super-admin identity)`);
    if (boundaryCrash) fails.push('error-boundary CRASH card rendered');
    if (body.length < 60) fails.push(`near-blank (bodyLen=${body.length})`);
    if (!heading) fails.push('no section heading mounted');
    if (errors.length) fails.push(`console: ${errors.slice(0, 2).join(' | ')}`);
    if (fails.length) problems++;
    rows.push({ s, landed, headingOk: !!heading, bodyLen: body.length, pass: fails.length === 0, fails });
  } catch (e) {
    problems++;
    rows.push({ s, pass: false, fails: [`nav/load threw: ${String(e).slice(0, 100)}`] });
  }
  page.off('console', onErr);
  page.off('pageerror', onPageErr);
}
await browser.close();

for (const r of rows) {
  const mark = r.pass ? '✓' : '✗';
  console.log(`  ${mark} /admin/${r.s.padEnd(16)} landed=${r.landed ?? '?'} heading=${r.headingOk ? 'yes' : 'NO'} bodyLen=${r.bodyLen ?? 0}${r.pass ? '' : '  FAILS: ' + r.fails.join('; ')}`);
}
if (problems) {
  console.error(`\nVERDICT: ❌ FAIL — ${problems}/${SECTIONS.length} sysAdmin section(s) do not render gracefully (crash/blank/bounce/console). These are surf-audit-blind — this is the ONLY always-on guard for them.`);
  process.exit(1);
}
console.log(`\nVERDICT: ✅ PASS — all ${SECTIONS.length} sysAdmin sections render gracefully under the client-admit + server-403 path (no crash/blank/bounce/console); AL-155 crash class stays closed.`);
