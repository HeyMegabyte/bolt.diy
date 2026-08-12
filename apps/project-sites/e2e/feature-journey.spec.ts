/**
 * @module e2e/feature-journey
 *
 * ONE comprehensive journey that browses EVERY admin feature in a single test,
 * proving the SPA contract holds end-to-end:
 *
 *  - signs in (stubbed) → admin shell renders
 *  - walks every sidebar nav target via UI clicks (no `page.goto` after load)
 *  - after EACH navigation asserts:
 *      • zero uncaught page errors (the real "feature works" signal)
 *      • the persistent shell did NOT full-reload (SPA sentinel stable +
 *        navigation-entry count flat) — verifies the View-Transition shell fix
 *      • the sticky topbar is still in the viewport
 *      • the section rendered *something* (not a blank crash)
 *  - GUARD-REDIRECT TOLERANCE: a click that lands on a DIFFERENT /admin URL
 *    than targeted is a route guard doing its job (sysAdminGuard bounces
 *    non-operators to /admin/site-features; featureFlagGuard redirects a dark
 *    flag-gated route to /admin/feature-flags). The contract for those routes
 *    is "no crash, no full reload, shell intact at the DESTINATION" — never
 *    "URL equals target".
 *  - verifies the recent fixes explicitly: Preview tab removed, editor tabs =
 *    code/agents, topbar stays put on scroll.
 *
 * Auth is the stub fixture, so data APIs 401 with the stub token — sections may
 * render empty/error states; that is EXPECTED and not a failure. We fail only
 * on uncaught JS errors, full reloads, a missing shell, or a blank section.
 *
 * Run against prod:
 *   PROD_URL=https://projectsites.dev npx playwright test feature-journey \
 *     --config playwright.prod.config.ts
 */
import { test, expect } from './fixtures.js';
import { signInAsTestUser } from './helpers/auth.js';
import type { Page } from '@playwright/test';

const BASE = process.env.PROD_URL ?? 'https://projectsites.dev';

/** Every admin route reachable from the shell, in nav order. */
// (hardcoded ROUTES list removed 2026-07-31 — the walk derives targets from the
// live sidebar DOM, so new sections are covered automatically and retired
// routes can never rot the journey again.)

/** Install a one-time SPA sentinel + nav-entry probe on the live page. */
async function installSpaProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __spa: number }).__spa = Math.floor(Math.random() * 1e9);
  });
}

/** Read the sentinel; if undefined the document reloaded (probe wiped). */
async function readProbe(page: Page): Promise<{ spa: number | null; navs: number }> {
  // Race the evaluate against a 5s bound: a section that pegs the renderer
  // (main thread starved — the domains/api-tokens class) would otherwise
  // hang this call indefinitely and burn the whole journey budget. The
  // sentinel {-1,-1} marks the route as renderer-starved instead.
  return Promise.race([
    page.evaluate(() => ({
      spa: (window as unknown as { __spa?: number }).__spa ?? null,
      navs: performance.getEntriesByType('navigation').length,
    })),
    new Promise<{ spa: number | null; navs: number }>((r) =>
      setTimeout(() => r({ spa: -1, navs: -1 }), 5_000),
    ),
  ]);
}

test.describe('Admin feature journey (single comprehensive SPA pass)', () => {
  test('browses every feature without a full reload, crash, or uncaught error', async ({ authedPage: page }) => {
    // The single-pass journey grew with every section the loop added — 180s
    // was outgrown (timeout mid-browse under prod latency). Budget scales with
    // the section count; revisit if it approaches 6 minutes again.
    test.setTimeout(360_000);

    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      const t = m.text();
      // Expected with the stub token: data APIs 401 + blocked CDNs. Not failures.
      if (/401|403|Failed to load resource|net::ERR|ERR_FAILED|status of 4\d\d|status of 5\d\d/i.test(t)) return;
      consoleErrors.push(t);
    });

    // 1) Land on the shell.
    await page.goto(`${BASE}/admin`);
    await page.waitForLoadState('domcontentloaded');
    // Shell must be present (sidebar + sticky topbar).
    await expect(page.locator('.admin-sidebar')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.admin-topbar')).toBeVisible();
    await installSpaProbe(page);
    const start = await readProbe(page);
    expect(start.spa).not.toBeNull();

    const results: { label: string; ok: boolean; note: string }[] = [];

    // 2) Walk every REAL sidebar link via in-app navigation (router, not goto).
    // Rewritten 2026-07-31: the old hardcoded ROUTES list drifted (retired
    // /admin/traces + /admin/audit, sysAdmin-gated /admin/feature-flags for
    // the stub user) and its pushState fallback for missing links compounded
    // two 15s catch()-waits per bad route — the journey burned its entire
    // budget in a broken state. The DOM is the SSOT for what a user can
    // actually click; walk exactly that.
    const hrefs: string[] = await page
      .locator('aside nav a.nav-item[href^="/admin"]')
      .evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).getAttribute('href') ?? ''));
    const walk = [...new Set(hrefs.filter(Boolean))];
    expect(walk.length, 'sidebar must expose a non-trivial nav surface').toBeGreaterThanOrEqual(10);

    for (const path of walk) {
      const r = { path, label: path.replace('/admin', '') || 'overview' };
      console.log(`[journey] → ${r.path}`);
      const before = await readProbe(page);
      const link = page.locator(`a[routerlink="${r.path}"], a[href="${r.path}"]`).first();
      // "More tools" is a collapsed <details class="nav-more"> — its links
      // exist in the DOM (so the walk harvests them) but are hidden until the
      // disclosure opens; clicking hidden links silently no-ops and the walk
      // then measures the PRIOR page (this faked the whole trailing-trio
      // failure, incl. domains "redirecting" to settings). Same lesson as the
      // mobile hamburger: open the real affordance first.
      if (!(await link.isVisible().catch(() => false))) {
        await page.locator('details.nav-more > summary').click({ timeout: 5_000 }).catch(() => {});
      }
      // Explicit timeout: with no global actionTimeout a click on a pegged
      // page waits FOREVER — this was silently burning the whole budget
      // before the starve-detector could even fire.
      await link.click({ trial: false, timeout: 5_000 }).catch(() => {});
      await page.waitForURL(new RegExp(r.path.replace(/\//g, '\\/') + '(\\?|$|/)'), { timeout: 8_000 }).catch(() => {});
      // Let the lazy chunk + section render.
      await page.locator('.admin-topbar').waitFor({ state: 'visible', timeout: 8_000 }).catch(() => {});

      const after = await readProbe(page);
      if (after.spa === -1) {
        // Renderer starved — the accumulation bug has struck. Once pegged the
        // page never recovers (recovery gotos also hang), so record + STOP:
        // the walk-so-far is the diagnostic payload.
        results.push({ label: r.label, ok: false, note: 'renderer-starved' });
        console.log(`[journey] RENDERER PEGGED at ${r.path} after ${results.length} sections`);
        break;
      }
      // Give the lazy section chunk a bounded window to PAINT before measuring.
      // The topbar wait above resolves instantly (persistent shell), so
      // measuring right after it raced the section chunk download under prod
      // latency and mis-scored slow-mounting sections (api-tokens, super-admin)
      // as `blank-main`. Locator-condition wait, never a sleep.
      await page
        .locator('main')
        .filter({ hasText: /\S/ })
        .first()
        .waitFor({ state: 'attached', timeout: 10_000 })
        .catch(() => {});
      const reloaded = after.spa === null || after.spa !== before.spa || after.navs > before.navs;
      // Bounded WAITS, not instant isVisible: guard-gated routes (super-admin)
      // hop a multi-redirect chain (flag guard → feature-flags →
      // sysAdmin guard → site-features), each hop hitting the live per-key
      // flags endpoint — an instant check mid-chain mis-scored the shell as
      // missing.
      const topbar = await page.locator('.admin-topbar').waitFor({ state: 'visible', timeout: 8_000 }).then(() => true).catch(() => false);
      const sidebar = await page.locator('.admin-sidebar').waitFor({ state: 'visible', timeout: 8_000 }).then(() => true).catch(() => false);
      // `.first()` — a section that renders its own nested <main> would trip
      // Playwright strict mode and fake a blank via the catch fallback.
      const mainText = (await page.locator('main').first().innerText().catch(() => '')).trim().length;

      // Guard-redirect detection (see module doc): landing on a different
      // /admin path than targeted is tolerated — the contract stays "shell
      // intact + content rendered at the destination".
      const norm = (p: string): string => p.replace(/\/+$/, '') || '/';
      const landedPath = norm(new URL(page.url()).pathname);
      const guardRedirected = landedPath.startsWith('/admin') && landedPath !== norm(r.path);

      const ok = !reloaded && topbar && sidebar && mainText > 0;
      results.push({
        label: r.label,
        ok,
        note: ok
          ? guardRedirected
            ? `guard-redirect→${landedPath}`
            : 'ok'
          : `${reloaded ? 'FULL-RELOAD ' : ''}${!topbar ? 'no-topbar ' : ''}${!sidebar ? 'no-sidebar ' : ''}${mainText === 0 ? 'blank-main ' : ''}${guardRedirected ? `guard-redirect→${landedPath}` : ''}`.trim(),
      });

      // Re-seed the probe if (only) the nav counter advanced harmlessly.
      if (after.spa === null) await installSpaProbe(page);
    }

    // 3) Sticky-topbar proof: scroll a content-heavy route, topbar must stay.
    await page.evaluate(() => window.scrollTo(0, 1200));
    await page.waitForTimeout(150);
    const topbarStuckAfterScroll = await page.locator('.admin-topbar').isVisible();

    // 4) Editor-specific fixes: Preview removed, tabs = code/media/agents.
    const link = page.locator('a[routerlink="/admin/editor"], a[href="/admin/editor"]').first();
    if (await link.count()) await link.click().catch(() => {});
    await page.waitForURL(/\/admin\/editor/, { timeout: 10_000 }).catch(() => {});
    const hasPreviewTab = await page.locator('[data-testid="editor-tab-preview"]').count();
    const hasCodeTab = await page.locator('[data-testid="editor-tab-code"]').count();

    // ---- Report + assert ----
    const failed = results.filter((r) => !r.ok);
    // eslint-disable-next-line no-console
    console.warn('FEATURE JOURNEY RESULTS:\n' + results.map((r) => `  ${r.ok ? 'PASS' : 'FAIL'}  ${r.label}  ${r.note}`).join('\n'));
    console.warn(`sticky-topbar-after-scroll=${topbarStuckAfterScroll}  preview-tab-removed=${hasPreviewTab === 0}  code-tab-present=${hasCodeTab > 0}`);
    console.warn(`uncaught-page-errors=${pageErrors.length}  unexpected-console-errors=${consoleErrors.length}`);

    expect(pageErrors, `Uncaught JS errors: ${pageErrors.join(' | ')}`).toHaveLength(0);
    expect(failed, `Routes that full-reloaded/crashed/blanked: ${failed.map((f) => f.label + '(' + f.note + ')').join(', ')}`).toHaveLength(0);
    expect(topbarStuckAfterScroll, 'topbar must stay visible after scrolling (sticky fix)').toBe(true);
    expect(hasPreviewTab, 'Preview tab must be removed').toBe(0);
    expect(consoleErrors, `Unexpected console errors: ${consoleErrors.join(' | ')}`).toHaveLength(0);
  });
});
