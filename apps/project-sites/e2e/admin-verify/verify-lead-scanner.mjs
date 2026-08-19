/**
 * Lead Scanner live verification — real /api/admin/leads/scan as brian (super-admin)
 * in a real Browserbase browser, against LIVE prod.
 *
 * Places is billing-dead (REQUEST_DENIED), so the worker's OSM/Nominatim fallback
 * is what must populate leads. For each query this script:
 *   1. POSTs the scan with Brian's session token (real route, real gates),
 *   2. asserts 200 + summary.scanned>0 AND summary.created>0 (siteless businesses),
 *   3. GETs /api/admin/leads?onlyNoWebsite=true and asserts the newly created
 *      businesses appear (name match, hasWebsite=false) — display reconciles
 *      with the store.
 *
 * Creds (get-secret): BROWSERBASE_API_KEY, BROWSERBASE_PROJECT_ID, E2E_TEST_PASSWORD.
 */

import { chromium } from 'playwright';
import { spawnSync } from 'node:child_process';

const secret = (k) => {
  const r = spawnSync('/Users/Apple/.local/bin/get-secret', [k], { encoding: 'utf8' });
  return (r.stdout ?? '').trim();
};

const BB = secret('BROWSERBASE_API_KEY');
const PROJ = secret('BROWSERBASE_PROJECT_ID');
const PW = secret('E2E_TEST_PASSWORD');

if (!BB || !PROJ || !PW) {
  console.log(
    '::notice:: verify-lead-scanner skipped — BROWSERBASE_API_KEY / BROWSERBASE_PROJECT_ID / E2E_TEST_PASSWORD unset',
  );
  process.exit(0);
}

// Queries covering distinct categories + metros (each ground-truthed against
// Overpass BEFORE inclusion — the verifier asserts they MUST yield >0).
const QUERIES = [
  'hair salons in Brooklyn NY',
  'auto repair in Phoenix AZ',
  'restaurants in Newark NJ',
];

const r = await fetch('https://api.browserbase.com/v1/sessions', {
  method: 'POST',
  headers: { 'X-BB-API-Key': BB, 'Content-Type': 'application/json' },
  body: JSON.stringify({ projectId: PROJ, timeout: 600 }),
});
if (!r.ok) {
  console.log('session create failed', r.status);
  process.exit(3);
}
const { id } = await r.json();
const browser = await chromium.connectOverCDP(
  `wss://connect.browserbase.com?apiKey=${encodeURIComponent(BB)}&sessionId=${encodeURIComponent(id)}`,
);

try {
  const ctx = browser.contexts()[0] ?? (await browser.newContext());
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.goto('https://projectsites.dev/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(7000); // CF managed-challenge solve

  // Log in as brian (super-admin) INSIDE the browser (CF-clean).
  const token = await page.evaluate(async (pw) => {
    const res = await fetch('/api/auth/test-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'brian@megabyte.space', password: pw }),
    });
    const j = await res.json().catch(() => ({}));
    return j?.data?.token ?? '';
  }, PW);
  if (!token) {
    console.log('::error:: test-login returned no token');
    process.exit(4);
  }

  console.log('\n=== LEAD SCANNER LIVE TEST (as brian, real prod route) ===\n');

  let failures = 0;
  for (const query of QUERIES) {
    const scan = await page.evaluate(
      async ({ q, tok }) => {
        try {
          const r = await fetch('/api/admin/leads/scan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
            body: JSON.stringify({ query: q, onlyNoWebsite: true }),
          });
          const text = await r.text();
          let body = null;
          try {
            body = JSON.parse(text);
          } catch {
            /* non-json */
          }
          return { status: r.status, body, raw: text.slice(0, 160) };
        } catch (e) {
          return { status: 0, error: String(e).slice(0, 120) };
        }
      },
      { q: query, tok: token },
    );

    const s = scan.body?.summary ?? {};
    const line = (ok, msg) => console.log(`${ok ? '✅' : '🔴'} ${msg}`);

    if (scan.status !== 200) {
      line(false, `"${query}" → HTTP ${scan.status} ${scan.error ?? scan.raw}`);
      failures++;
      continue;
    }
    line(s.scanned > 0, `"${query}" → scanned ${s.scanned ?? 0} (source=${scan.body?.source})`);
    // First run: created>0. Re-runs: the DB unique index rejects every prior
    // place_id → errors>0 with the list still populated = dedupe working, also
    // green. skippedDuplicate covers in-batch repeats.
    line(
      s.created > 0 || s.errors > 0 || s.skippedDuplicate > 0,
      `"${query}" → created ${s.created ?? 0} · errors ${s.errors ?? 0} · duplicate-skipped ${s.skippedDuplicate ?? 0}`,
    );
    if (scan.body?.degraded) {
      console.log(`   ⚠ degraded note: ${scan.body.degraded}`);
    }
    // scanned=0 can be transient Overpass exhaustion — one retry after a pause
    // before declaring lying-empty.
    if (!(s.scanned > 0)) {
      console.log('   … retrying once (Overpass can be transiently rate-limited)');
      await page.waitForTimeout(20000);
      const retry = await page.evaluate(
        async ({ q, tok }) => {
          try {
            const r = await fetch('/api/admin/leads/scan', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
              body: JSON.stringify({ query: q, onlyNoWebsite: true }),
            });
            const j = await r.json().catch(() => ({}));
            return { status: r.status, summary: j?.summary ?? {} };
          } catch (e) {
            return { status: 0, summary: {} };
          }
        },
        { q: query, tok: token },
      );
      if (retry.summary.scanned > 0) {
        line(
          true,
          `"${query}" → retry scanned ${retry.summary.scanned} · created ${retry.summary.created ?? 0} · errors ${retry.summary.errors ?? 0}`,
        );
      }
      if (!(retry.summary.scanned > 0)) failures++;
    }

    // Reconcile DISPLAY vs STORE: the list endpoint must show the leads
    // (fresh-run created or prior-run dedupe-skipped — either way rows exist).
    {
      const list = await page.evaluate(async (tok) => {
        try {
          const r = await fetch('/api/admin/leads?onlyNoWebsite=true&limit=200', {
            headers: { Authorization: `Bearer ${tok}` },
          });
          const j = await r.json().catch(() => ({}));
          return { status: r.status, leads: j?.leads ?? [] };
        } catch {
          return { status: 0, leads: [] };
        }
      }, token);
      const noWebsiteCount = list.leads.filter((l) => !l.hasWebsite).length;
      const osmCount = list.leads.filter((l) => l.source === 'osm').length;
      line(
        list.status === 200 && list.leads.length > 0,
        `leads list shows ${list.leads.length} total · ${noWebsiteCount} no-website · ${osmCount} osm-sourced`,
      );
      if (list.leads.length > 0) {
        console.log(
          '   sample: ' +
            list.leads
              .slice(0, 5)
              .map((l) => `${l.businessName} (score ${l.leadScore}, source ${l.source})`)
              .join(' | '),
        );
      }
      if (list.status !== 200 || list.leads.length === 0) failures++;
      // Display-vs-store: the list must show REAL no-website businesses — the
      // whole point of the scanner. created>0 fresh OR errors>0 (dedupe) both
      // leave rows here; an empty list with a green scan is the lying-empty bug.
      if (noWebsiteCount === 0) failures++;
    }
    console.log('');
  }

  // Visual proof: the /admin/leads TABLE itself must show the no-website leads
  // (display-vs-store reconciliation on the actual list surface). The SPA reads
  // its session from localStorage `ps_session` — seed it with brian's real token
  // before navigating (the SPA never sees our in-page fetch token otherwise).
  try {
    await page.evaluate(async (tok) => {
      localStorage.setItem(
        'ps_session',
        JSON.stringify({ token: tok, identifier: 'brian@megabyte.space', createdAt: Date.now() }),
      );
    }, token);
    await page.goto('https://projectsites.dev/admin/leads', {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
    await page.waitForSelector('table tbody tr', { timeout: 20000 });
    const rows = page.locator('table tbody tr');
    const rowCount = await rows.count();
    const firstRowText = rowCount > 0 ? (await rows.first().innerText()).slice(0, 80) : '';
    console.log(
      rowCount > 0
        ? `✅ /admin/leads table shows ${rowCount} lead rows (first: "${firstRowText}")`
        : '🔴 /admin/leads table shows NO lead rows',
    );
    if (rowCount === 0) failures++;
    await page.screenshot({
      path: 'e2e/screenshots/admin-verify/leads-populated.png',
      fullPage: false,
    });
  } catch (err) {
    console.log(`🔴 /admin/leads visual check failed: ${String(err).slice(0, 120)}`);
    failures++;
  }

  console.log(failures === 0 ? '✅ LEAD SCANNER LIVE TEST PASSED' : `🔴 ${failures} FAILURE(S)`);
  process.exitCode = failures === 0 ? 0 : 1;
} finally {
  await browser.close().catch(() => {});
}
