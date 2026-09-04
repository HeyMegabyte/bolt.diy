// reconcile-e2e-sites.mjs — CHEAP per-fire truthful-persistence guard (no Browserbase).
// Reconciles the /api/sites DISPLAY count against the D1 GROUND-TRUTH live-site count for
// the e2e-test-org, catching the lying-empty / silent-cap class (verify-against-source-of-
// truth): a `{data:[]}`-only endpoint that caps or reads the wrong source shows fewer rows
// than the store holds, and every render-integrity gate stays green. Companion to the
// Browserbase-gated reconcile-surfaces.mjs (which reconciles brian's account). Fail-open
// when creds are unset. Exit 1 on divergence. Usage:
//   E2E_API_KEY=… CLOUDFLARE_API_KEY=… CLOUDFLARE_EMAIL=… node e2e/admin-verify/reconcile-e2e-sites.mjs
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const req = createRequire(resolve(__dirname, '../../frontend/'));
const { chromium } = req('playwright');

const KEY = process.env.E2E_API_KEY;
const CF_KEY = process.env.CLOUDFLARE_API_KEY;
if (!KEY || !CF_KEY) {
  console.log('::notice:: reconcile-e2e-sites skipped — E2E_API_KEY / CLOUDFLARE_API_KEY unset (fail-open).');
  process.exit(0);
}
const ORIGIN = process.env.ORIGIN || 'https://projectsites.dev';
const ORG = 'e2e-test-org';

// 1) D1 GROUND TRUTH — live (non-deleted) sites for the e2e org. Read-only SELECT.
function d1Count() {
  const out = execFileSync(
    'npx',
    [
      'wrangler', 'd1', 'execute', 'project-sites-db-production', '--remote', '--json',
      '--command', `SELECT COUNT(*) AS n FROM sites WHERE org_id='${ORG}' AND deleted_at IS NULL`,
    ],
    { cwd: resolve(__dirname, '../..'), encoding: 'utf-8', env: process.env, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const json = JSON.parse(out.slice(out.indexOf('[')));
  return Number(json[0]?.results?.[0]?.n ?? json[0]?.results?.[0]?.['COUNT(*)'] ?? NaN);
}

// 2) DISPLAY — /api/sites as the e2e org, from a real browser (WAF-safe).
async function displayCount() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
  });
  const page = await ctx.newPage();
  await page.goto(ORIGIN + '/', { waitUntil: 'domcontentloaded', timeout: 45000 });
  const r = await page.evaluate(async (k) => {
    const res = await fetch('/api/sites', { headers: { Authorization: 'Bearer ' + k } });
    const j = await res.json().catch(() => null);
    const rows = Array.isArray(j?.data) ? j.data.length : Array.isArray(j) ? j.length : -1;
    const total = j?.total ?? j?.meta?.total ?? j?.pagination?.total ?? null;
    return { status: res.status, rows, total };
  }, KEY);
  await browser.close();
  return r;
}

const ground = d1Count();
const disp = await displayCount();
console.log(`━━ reconcile /api/sites (${ORG}) ━━`);
console.log(`  D1 ground-truth (live sites): ${ground}`);
console.log(`  /api/sites display rows:      ${disp.rows}  (status ${disp.status}, total field: ${disp.total})`);

let verdict = 'OK';
if (ground > 0 && disp.rows === 0) verdict = 'LYING-EMPTY (store has rows, display shows 0)';
else if (disp.rows < ground) verdict = `SILENT-CAP / WRONG-SOURCE (display ${disp.rows} < store ${ground}${disp.total == null ? ', no total field to disclose the cap' : ''})`;
else if (disp.rows > ground) verdict = `DISPLAY > STORE (${disp.rows} > ${ground}) — stale/cross-org leak?`;
console.log(`  VERDICT: ${verdict === 'OK' ? '✓ truthful (display == store)' : '✗ ' + verdict}`);

process.exit(verdict === 'OK' ? 0 : 1);
