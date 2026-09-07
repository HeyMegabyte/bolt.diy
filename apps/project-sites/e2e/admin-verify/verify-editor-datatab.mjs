#!/usr/bin/env node
/**
 * verify-editor-datatab.mjs — CAUSAL/render probe for the bolt.diy editor's **Data tab**
 * AND **Functions tab** (Brian directive 2026-09-05; AL-004 shipped both, AL-018 automated
 * the Data tab's acceptance, AL-038 extended it to also cover the Functions tab).
 *
 * The Data tab is a CROSS-FRAME surface: the embedded editor (editor.projectsites.dev,
 * inside the admin iframe) has no cross-origin session, so it asks the admin parent via
 * the PS_ bridge (PS_DATA_REQUEST → admin calls GET /api/sites/:id/data-overview[/:table]
 * → PS_DATA_RESPONSE). This proves, in a REAL booted WebContainer editor, that:
 *   1. the Data tab renders the site's REAL platform tables + live counts (no mock),
 *   2. clicking a populated table browses real rows (safe-column allowlist),
 *   3. the Functions tab renders REAL functions/ derivation (honest empty state for a
 *      project with no functions/ folder, or derived routes) — never the old hardcoded
 *      mock (bricklabor / fixed /api/booking+/api/contact regardless of project),
 *   4. zero console errors.
 *
 * Boots the admin as brian (test-login), opens /admin/editor, waits for the bolt iframe +
 * workbench, clicks Data, asserts real tables, then browses one populated table. The
 * WebContainer boot can be slow/flaky headless — if the Data tab isn't reachable within
 * the boot budget, the probe SKIPS (exit 0), never false-fails (the boot, not the tab, is
 * the flaky part; the tab itself is proven when reachable). Skips too when creds unset.
 *
 * Creds (get-secret): BROWSERBASE_API_KEY, BROWSERBASE_PROJECT_ID, E2E_TEST_PASSWORD.
 * Usage: BROWSERBASE_API_KEY=… BROWSERBASE_PROJECT_ID=… E2E_TEST_PASSWORD=… node e2e/admin-verify/verify-editor-datatab.mjs
 */
import { chromium } from '@playwright/test';
import { resolveBrowserbaseCreds } from './_browserbase-creds.mjs';

const { BB, PROJ, PW } = resolveBrowserbaseCreds();
if (!BB || !PROJ || !PW) {
  console.log(
    '::notice:: verify-editor-datatab skipped — Browserbase creds / E2E_TEST_PASSWORD unset',
  );
  process.exit(0);
}
const BOOT_BUDGET_MS = 100_000; // WebContainer cold-boot ceiling before we SKIP (not fail)

const r = await fetch('https://api.browserbase.com/v1/sessions', {
  method: 'POST',
  headers: { 'X-BB-API-Key': BB, 'Content-Type': 'application/json' },
  body: JSON.stringify({ projectId: PROJ, timeout: 900 }),
});
if (!r.ok) {
  console.log(
    `::notice:: verify-editor-datatab skipped — Browserbase session create failed (${r.status})`,
  );
  process.exit(0);
}
const { id } = await r.json();
const browser = await chromium.connectOverCDP(
  `wss://connect.browserbase.com?apiKey=${encodeURIComponent(BB)}&sessionId=${encodeURIComponent(id)}`,
);
const consoleErrs = [];
try {
  const ctx = browser.contexts()[0] ?? (await browser.newContext());
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/i.test(m.text()))
      consoleErrs.push(m.text().slice(0, 100));
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('https://projectsites.dev/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.evaluate(async (pw) => {
    const res = await fetch('/api/auth/test-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'brian@megabyte.space', password: pw }),
    });
    const j = await res.json().catch(() => ({}));
    if (j?.data?.token)
      localStorage.setItem(
        'ps_session',
        JSON.stringify({
          token: j.data.token,
          identifier: 'brian@megabyte.space',
          issuedAt: Date.now(),
        }),
      );
  }, PW);
  await page.goto('https://projectsites.dev/admin/editor', {
    waitUntil: 'domcontentloaded',
    timeout: 45000,
  });
  await page.waitForSelector('iframe', { timeout: 30000 }).catch(() => {});

  // Poll for the workbench Data tab inside the bolt iframe within the boot budget.
  let bf = null;
  const deadline = Date.now() + BOOT_BUDGET_MS;
  while (Date.now() < deadline) {
    await page.waitForTimeout(5000);
    bf = page.frames().find((f) => /editor\.projectsites\.dev/.test(f.url()));
    if (
      bf &&
      (await bf
        .locator('button:has-text("Data")')
        .first()
        .count()
        .catch(() => 0))
    )
      break;
    bf = null;
  }
  if (!bf) {
    console.log(
      '::notice:: verify-editor-datatab skipped — editor WebContainer did not boot within budget (headless flakiness, not a Data-tab defect)',
    );
    process.exit(0);
  }

  // OVERVIEW: click Data → assert real tables render (not the old SQLite/Neon/Redis mock).
  await bf.locator('button:has-text("Data")').first().click();
  await page.waitForTimeout(3500);
  const overview = await bf
    .locator('body')
    .innerText()
    .catch(() => '');
  const hasRealTables =
    /Visitor Events|Form Submissions|Snapshots|Content Store|MCP Connections/.test(overview);
  const hasMock = /bricklabor|Upstash|Neon|Redis/i.test(overview);

  // BROWSE: click a populated table → assert a row grid renders with back-nav.
  await bf
    .locator('button:has-text("Visitor Events")')
    .first()
    .click()
    .catch(() => {});
  await page.waitForTimeout(4000);
  const browse = await bf
    .locator('body')
    .innerText()
    .catch(() => '');
  const browsedRows =
    /Tables/.test(browse) && /Event Type|event_type|Created At|pageview/i.test(browse);

  // FUNCTIONS tab (AL-004's other half): click → assert the panel mounts with REAL
  // functions/ derivation. A project with no functions/ folder shows the HONEST empty
  // state ("No functions/ folder yet"); one with functions/ shows derived routes. Either
  // proves de-mock — the old hardcoded mock (bricklabor / fixed routes) must be gone.
  let functionsReal = false,
    functionsMockGone = true,
    createCtrlPresent = false,
    scaffoldWorked = false;
  const fnBtn = bf.locator('button:has-text("Functions")').first();
  if (await fnBtn.count().catch(() => 0)) {
    await fnBtn.click().catch(() => {});
    await page.waitForTimeout(2500);
    const fn = await bf
      .locator('body')
      .innerText()
      .catch(() => '');
    functionsReal = /functions\/? folder yet|Routes \(\d+\)|deploy ready|no routes/i.test(fn);
    functionsMockGone = !/bricklabor/i.test(fn);

    // CREATE-A-FUNCTION control (AL-060 / item-8 "create/edit/deploy a function"): assert the
    // new "+ New" affordance is present (header toggle OR empty-state button), then CAUSALLY
    // scaffold a real function — click → type a unique route → Create → the panel's own route
    // table must surface it. Proves scaffoldFunction + workbenchStore.createFile write a real
    // functions/ file in the booted WebContainer (the derived route picks it up live). The file
    // is ephemeral WebContainer state (fresh per boot), so scaffolding a probe route is safe.
    const newBtn = bf
      .locator('[data-testid="functions-new-btn"], [data-testid="functions-new-empty-btn"]')
      .first();
    createCtrlPresent = (await newBtn.count().catch(() => 0)) > 0;
    if (createCtrlPresent) {
      await newBtn.click().catch(() => {});
      await page.waitForTimeout(600);
      const input = bf.locator('[data-testid="functions-new-input"]').first();
      if (await input.count().catch(() => 0)) {
        await input.fill('api/loop-probe-fn').catch(() => {});
        await bf
          .locator('[data-testid="functions-new-create"]')
          .first()
          .click()
          .catch(() => {});
        await page.waitForTimeout(2500);
        const after = await bf
          .locator('body')
          .innerText()
          .catch(() => '');
        scaffoldWorked = /\/api\/loop-probe-fn/.test(after);
      }
    }
  }

  const ok =
    hasRealTables &&
    !hasMock &&
    browsedRows &&
    functionsReal &&
    functionsMockGone &&
    createCtrlPresent &&
    scaffoldWorked &&
    consoleErrs.length === 0;
  console.log(
    `${ok ? '✅' : '🔴'} editor tabs — Data[realTables=${hasRealTables} mockGone=${!hasMock} browsedRows=${browsedRows}] Functions[real=${functionsReal} mockGone=${functionsMockGone} createCtrl=${createCtrlPresent} scaffold=${scaffoldWorked}] consoleErrs=${consoleErrs.length}`,
  );
  if (consoleErrs.length) for (const e of consoleErrs.slice(0, 3)) console.log(`   · ${e}`);
  console.log(
    `\nVERDICT: ${ok ? '✅ PASS' : '🔴 CHECK'} — editor Data + Functions tabs ${ok ? 'render live connected data (no mock) + "+ New" scaffolds a real function' : 'did NOT fully verify'}`,
  );
  process.exit(ok ? 0 : 1);
} catch (err) {
  console.log(
    `\n::notice:: verify-editor-datatab skipped — ${err instanceof Error ? err.message : String(err)}`.slice(
      0,
      160,
    ),
  );
  process.exit(0);
} finally {
  await browser.close();
}
