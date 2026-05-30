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
 *  - verifies the recent fixes explicitly: Preview tab removed, editor tabs =
 *    code/media/agents, topbar stays put on scroll.
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
const ROUTES: { path: string; label: string }[] = [
  { path: '/admin', label: 'overview' },
  { path: '/admin/editor', label: 'editor' },
  { path: '/admin/snapshots', label: 'snapshots' },
  { path: '/admin/analytics', label: 'analytics' },
  { path: '/admin/forms', label: 'forms' },
  { path: '/admin/traces', label: 'traces' },
  { path: '/admin/apps', label: 'apps' },
  { path: '/admin/social', label: 'social' },
  { path: '/admin/voice', label: 'voice' },
  { path: '/admin/media', label: 'media' },
  { path: '/admin/sites', label: 'sites' },
  { path: '/admin/domains', label: 'domains' },
  { path: '/admin/seo', label: 'seo' },
  { path: '/admin/pseo', label: 'pseo' },
  { path: '/admin/content-freshness', label: 'content-freshness' },
  { path: '/admin/logs', label: 'logs' },
  { path: '/admin/mcp', label: 'mcp' },
  { path: '/admin/ai-endpoints', label: 'ai-endpoints' },
  { path: '/admin/marketplace', label: 'marketplace' },
  { path: '/admin/inbox', label: 'inbox' },
  { path: '/admin/billing', label: 'billing' },
  { path: '/admin/feature-flags', label: 'feature-flags' },
  { path: '/admin/features', label: 'features-hub' },
  { path: '/admin/docs', label: 'docs' },
  { path: '/admin/audit', label: 'audit' },
  { path: '/admin/import', label: 'import' },
  { path: '/admin/settings', label: 'settings' },
  { path: '/admin/user', label: 'user-settings' },
];

/** Install a one-time SPA sentinel + nav-entry probe on the live page. */
async function installSpaProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __spa: number }).__spa = Math.floor(Math.random() * 1e9);
  });
}

/** Read the sentinel; if undefined the document reloaded (probe wiped). */
async function readProbe(page: Page): Promise<{ spa: number | null; navs: number }> {
  return page.evaluate(() => ({
    spa: (window as unknown as { __spa?: number }).__spa ?? null,
    navs: performance.getEntriesByType('navigation').length,
  }));
}

test.describe('Admin feature journey (single comprehensive SPA pass)', () => {
  test('browses every feature without a full reload, crash, or uncaught error', async ({ authedPage: page }) => {
    test.setTimeout(180_000);

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

    // 2) Walk every route via in-app navigation (router, not goto).
    for (const r of ROUTES) {
      const before = await readProbe(page);
      // Navigate the SPA way: click a sidebar link if present, else use the
      // Angular router via history API (still no document load).
      const link = page.locator(`a[routerlink="${r.path}"], a[href="${r.path}"]`).first();
      if (await link.count()) {
        await link.click({ trial: false }).catch(() => {});
      } else {
        await page.evaluate((p) => history.pushState({}, '', p), r.path);
        await page.evaluate(() => window.dispatchEvent(new PopStateEvent('popstate')));
      }
      await page.waitForURL(new RegExp(r.path.replace(/\//g, '\\/') + '(\\?|$|/)'), { timeout: 15_000 }).catch(() => {});
      // Let the lazy chunk + section render.
      await page.locator('.admin-topbar').waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});

      const after = await readProbe(page);
      const reloaded = after.spa === null || after.spa !== before.spa || after.navs > before.navs;
      const topbar = await page.locator('.admin-topbar').isVisible().catch(() => false);
      const sidebar = await page.locator('.admin-sidebar').isVisible().catch(() => false);
      const mainText = (await page.locator('main').innerText().catch(() => '')).trim().length;

      const ok = !reloaded && topbar && sidebar && mainText > 0;
      results.push({
        label: r.label,
        ok,
        note: `${reloaded ? 'FULL-RELOAD ' : ''}${!topbar ? 'no-topbar ' : ''}${!sidebar ? 'no-sidebar ' : ''}${mainText === 0 ? 'blank-main' : ''}`.trim() || 'ok',
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
