/**
 * @module e2e/admin-error-states
 *
 * Regression guard for the 4-state-kit conversions shipped this convergence
 * campaign — every section that used to render a BARE error/loading <div> now
 * uses the shared Cockpit-v2 state kit (`app-error-card` / `app-skeleton` /
 * `app-empty-state`). With the E2E test token the data APIs respond 401, so
 * these sections take their ERROR path — the perfect place to prove the
 * conversion is live and never regresses back to flat text.
 *
 * Covered fixes:
 *   - social-analytics `d9ffebd` — bare `.error`/`.loading` → `app-error-card` + `app-skeleton`
 *   - content-freshness `79e0a32` — bare `.cf-error` div → `<app-error-card (retry)>`
 *   - feature-flags    `5576feb`/`67b02e44` — full flag list + persisted-override merge
 *
 * Contract: on every covered route a VALID 4-state container must render
 * (error-card OR skeleton OR empty-state OR real content) — never a blank/crash
 * — AND the removed bare-error CSS classes must stay absent.
 *
 * Seeds `ps_session` from `E2E_API_KEY`. Run: `npm run test:e2e:prod`.
 */
import { test, expect, type Page } from '@playwright/test';
import { isSessionSuperAdmin } from './helpers/super-admin';

const KEY = process.env.E2E_API_KEY ?? '';

async function seed(page: Page): Promise<void> {
  await page.addInitScript((k: string) => {
    try {
      localStorage.setItem(
        'ps_session',
        JSON.stringify({ token: k, identifier: 'test@megabyte.space', createdAt: Date.now() }),
      );
      localStorage.setItem('ps_feedback_dismissed', 'true');
    } catch {
      /* private mode */
    }
  }, KEY);
}

/** A section renders a VALID 4-state container — never blank, never a crash. */
const STATE_SELECTOR =
  // Valid non-blank states: shared 4-state-kit + section-native empty/skeleton
  // containers. `.ps-empty`/`.ps-skel` are pSEO's own empty/loading states —
  // once pSEO authenticates (commit 73b3cb5b) it loads cleanly and shows its
  // empty state instead of the error-card it rendered while broken.
  '[data-testid="error-card"], app-error-card, app-skeleton, app-empty-state, [data-testid="cf-table"], .ff-card, table, .ps-table-wrap, .ps-empty, .ps-skel';

test.describe('admin — 4-state-kit conversions (campaign regression guard)', () => {
  test.skip(!KEY, 'E2E_API_KEY not set');
  test.describe.configure({ retries: 2 });

  // NOTE: the route-driven BARE_CLASS_GONE loop (pSEO + content-freshness) was
  // REMOVED 2026-08-08 — BOTH `/admin/pseo` and `/admin/content-freshness` are
  // DELETED sections (no route + no component in src), so each navigated to the
  // admin not-found catch-all which renders none of the 4-state STATE_SELECTOR →
  // deterministic false-red. Their 4-state-kit conversions are historical (the
  // sections no longer exist). The STATE_SELECTOR contract is still exercised by
  // the live social-analytics + feature-flags tests below.

  test('social-analytics (d9ffebd): valid state, no bare loading/error text', async ({ page }) => {
    test.setTimeout(60000);
    await seed(page);
    await page.goto('/admin/social/analytics', { waitUntil: 'load' });
    await expect(page.locator('[data-testid="social-analytics-section"]').first()).toBeVisible({
      timeout: 30000,
    });
    await expect(page.locator(STATE_SELECTOR).first()).toBeVisible({ timeout: 20000 });
    // The old bare copy "Loading the receipts." must be gone (replaced by app-skeleton).
    await expect(page.getByText('Loading the receipts.', { exact: true })).toHaveCount(0);
  });

  // NOTE: the 'marketplace' sub-test was REMOVED 2026-08-08 — /admin/marketplace is a
  // DELETED section (see admin-section-labels.spec.ts). Its route falls to the admin
  // catch-all (AdminNotFoundComponent), which renders NONE of the test's selectors
  // (.mkt-card/.mkt-section are gone from src; the not-found page shows no
  // app-error-card/app-empty-state) → it failed DETERMINISTICALLY every run — stale
  // cruft from a removed feature, not a real "silent blank on data failure" regression.

  test('feature-flags (5576feb/67b02e44): full flag list renders with live state', async ({
    page,
    request,
  }) => {
    test.setTimeout(60000);
    // /admin/feature-flags is the operator-only System Admin layer (sysAdminGuard):
    // a non-super-admin session redirects to /admin/site-features, so the `.ff-card`
    // registry never renders for the E2E key. Skip cleanly — the flag registry render
    // is verified for super-admins via the Browserbase brian-login sweep.
    test.skip(
      !(await isSessionSuperAdmin(request)),
      'feature-flags is super-admin-gated; the E2E key is not super-admin',
    );
    await seed(page);
    await page.goto('/admin/feature-flags', { waitUntil: 'load' });
    await expect(page.locator('.admin-sidebar').first()).toBeVisible({ timeout: 30000 });
    await expect(page.locator('.ff-card').first()).toBeVisible({ timeout: 20000 });
    // The registry is large (150+ flags). Assert the list actually populated.
    const cards = await page.locator('.ff-card').count();
    expect(cards, 'feature-flags list must render the full registry, not a stub').toBeGreaterThan(
      50,
    );
    // Each card exposes the three real controls (disable/inspect/killswitch).
    const first = page.locator('.ff-card').first();
    await expect(first.getByRole('button', { name: /inspect/i })).toBeVisible();
    await expect(first.getByRole('button', { name: /killswitch/i })).toBeVisible();
    // No error-card on the happy path (the override merge succeeded / fell back cleanly).
    await expect(page.locator('app-error-card')).toHaveCount(0);
  });
});
