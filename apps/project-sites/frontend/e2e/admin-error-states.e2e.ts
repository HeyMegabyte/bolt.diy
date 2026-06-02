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
 *   - pSEO            `fa1863f` — bare `.ps-error` div → `<app-error-card (retry)>`
 *   - social-analytics `d9ffebd` — bare `.error`/`.loading` → `app-error-card` + `app-skeleton`
 *   - content-freshness `79e0a32` — bare `.cf-error` div → `<app-error-card (retry)>`
 *   - marketplace      `5576feb` — silent-empty-on-error → `<app-error-card (retry)>`
 *   - feature-flags    `5576feb`/`67b02e44` — full flag list + persisted-override merge
 *
 * Contract: on every covered route a VALID 4-state container must render
 * (error-card OR skeleton OR empty-state OR real content) — never a blank/crash
 * — AND the removed bare-error CSS classes must stay absent.
 *
 * Seeds `ps_session` from `E2E_API_KEY`. Run: `npm run test:e2e:prod`.
 */
import { test, expect, type Page } from '@playwright/test';

const KEY = process.env.E2E_API_KEY ?? '';

async function seed(page: Page): Promise<void> {
  await page.addInitScript((k: string) => {
    try {
      localStorage.setItem('ps_session', JSON.stringify({ token: k, identifier: 'test@megabyte.space', createdAt: Date.now() }));
      localStorage.setItem('ps_feedback_dismissed', 'true');
    } catch { /* private mode */ }
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

  // route → the bare error class we REMOVED (must never reappear).
  const BARE_CLASS_GONE: { path: string; bare: string; label: string }[] = [
    { path: '/admin/pseo', bare: '.ps-error', label: 'pSEO (fa1863f)' },
    { path: '/admin/content-freshness', bare: '.cf-error', label: 'content-freshness (79e0a32)' },
  ];

  for (const r of BARE_CLASS_GONE) {
    test(`${r.label}: renders a valid state + the bare error class is gone`, async ({ page }) => {
      test.setTimeout(60000);
      await seed(page);
      await page.goto(r.path, { waitUntil: 'load' });
      await expect(page.locator('.admin-sidebar').first()).toBeVisible({ timeout: 30000 });
      // A valid 4-state container must appear (never a blank section).
      await expect(page.locator(STATE_SELECTOR).first()).toBeVisible({ timeout: 20000 });
      // The removed bare-error div must NOT exist.
      await expect(page.locator(r.bare)).toHaveCount(0);
    });
  }

  test('social-analytics (d9ffebd): valid state, no bare loading/error text', async ({ page }) => {
    test.setTimeout(60000);
    await seed(page);
    await page.goto('/admin/social/analytics', { waitUntil: 'load' });
    await expect(page.locator('[data-testid="social-analytics-section"]').first()).toBeVisible({ timeout: 30000 });
    await expect(page.locator(STATE_SELECTOR).first()).toBeVisible({ timeout: 20000 });
    // The old bare copy "Loading the receipts." must be gone (replaced by app-skeleton).
    await expect(page.getByText('Loading the receipts.', { exact: true })).toHaveCount(0);
  });

  test('marketplace (5576feb): valid state, never a silent blank on data failure', async ({ page }) => {
    test.setTimeout(60000);
    await seed(page);
    await page.goto('/admin/marketplace', { waitUntil: 'load' });
    await expect(page.locator('.admin-sidebar').first()).toBeVisible({ timeout: 30000 });
    // Either real catalog cards, an empty-state, or an error-card — never blank.
    await expect(
      page.locator('[data-testid="error-card"], app-error-card, app-empty-state, .mkt-card, .mkt-section').first(),
    ).toBeVisible({ timeout: 20000 });
  });

  test('feature-flags (5576feb/67b02e44): full flag list renders with live state', async ({ page }) => {
    test.setTimeout(60000);
    await seed(page);
    await page.goto('/admin/feature-flags', { waitUntil: 'load' });
    await expect(page.locator('.admin-sidebar').first()).toBeVisible({ timeout: 30000 });
    await expect(page.locator('.ff-card').first()).toBeVisible({ timeout: 20000 });
    // The registry is large (150+ flags). Assert the list actually populated.
    const cards = await page.locator('.ff-card').count();
    expect(cards, 'feature-flags list must render the full registry, not a stub').toBeGreaterThan(50);
    // Each card exposes the three real controls (disable/inspect/killswitch).
    const first = page.locator('.ff-card').first();
    await expect(first.getByRole('button', { name: /inspect/i })).toBeVisible();
    await expect(first.getByRole('button', { name: /killswitch/i })).toBeVisible();
    // No error-card on the happy path (the override merge succeeded / fell back cleanly).
    await expect(page.locator('app-error-card')).toHaveCount(0);
  });
});
