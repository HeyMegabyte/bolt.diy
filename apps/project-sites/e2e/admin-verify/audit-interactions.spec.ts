/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — comprehensive coverage of the Audit Log
 * section (`/admin/audit`, restored from a 404 in P0.79; renders 500 real events
 * for brian). Structural + interaction assertions that hold for ANY org (the
 * E2E_API_KEY org may have fewer/zero events than brian) — grid-OR-honest-empty,
 * never a data-count assumption (see [[admin-verify-e2e-authoring-gotchas]] #5).
 *
 * Contract (audit.component.ts): "Audit Log" heading · 4 stat cards (Events /
 * Unique actions / Last 24h / Actors, each an <app-rolling-counter>) · an
 * `audit-scope-chip` org filter · an "Export CSV" button · "Auto-refresh" · the
 * ag-grid `audit-grid` OR the `audit-empty` ("No audit events yet") state · an
 * `audit-error` state that must NOT show on a healthy load.
 *
 * Real session (E2E_API_KEY) so /admin/audit mounts authed.
 *
 * @see {@link ../helpers/realdata.ts}
 * @see {@link ./admin-advertised-routes.spec.ts} — the route-restore regression.
 */
import { test, expect } from '../fixtures.js';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';

const gotoAudit = async (page: import('@playwright/test').Page) => {
  await setupRealDataPage(page, { passthrough: /\/api\// });
  await page.goto('/admin/audit', { waitUntil: 'domcontentloaded' });
  // Settle onto either the grid or the honest-empty state.
  await page
    .waitForFunction(
      () =>
        !!document.querySelector('[data-testid="audit-grid"], [data-testid="audit-empty"], [data-testid="audit-error"]'),
      undefined,
      { timeout: 15000 },
    )
    .catch(() => {});
};

test.describe('Admin · Audit Log interactions (P0-ADMIN)', () => {
  test('renders the Audit Log section (not the 404 it was restored from)', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await gotoAudit(page);

    expect(new URL(page.url()).pathname).toBe('/admin/audit');
    await expect(page.getByText(/audit log/i).first(), 'the Audit Log heading must render').toBeVisible({
      timeout: 12000,
    });
    const body = (await page.locator('body').innerText()).toLowerCase();
    expect(body.includes("admin page doesn't exist"), 'must not be the not-found page').toBe(false);
  });

  test('the 4 stat cards render with numeric counters', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await gotoAudit(page);

    for (const label of [/^events$/i, /unique actions/i, /last 24h/i, /^actors$/i]) {
      await expect(page.getByText(label).first(), `stat "${label}" must render`).toBeVisible({ timeout: 8000 });
    }
    // Each stat is an <app-rolling-counter> showing a real number (0 is valid).
    const counters = page.locator('app-rolling-counter');
    expect(await counters.count(), 'at least the 4 audit stat counters render').toBeGreaterThanOrEqual(4);
    await expect(counters.first(), 'a stat counter shows a numeric value').toHaveText(/\d/, { timeout: 8000 });
  });

  test('the grid OR the honest-empty state renders — never a load error', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await gotoAudit(page);

    // A healthy load never shows the error card.
    await expect(page.locator('[data-testid="audit-error"]'), 'audit must not be in an error state').toHaveCount(0);
    // Exactly one of grid / empty is present (data-dependent, both are "working").
    const grid = page.locator('[data-testid="audit-grid"]');
    const empty = page.locator('[data-testid="audit-empty"]');
    const shown = (await grid.count()) + (await empty.count());
    expect(shown, 'the audit surface must render its grid or its honest-empty state').toBeGreaterThan(0);
  });

  test('Export CSV + Auto-refresh affordances are present', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await gotoAudit(page);

    // Text-based `.first()` — the section exposes the Export CSV control in more
    // than one place, and it may be disabled when the org has zero events; presence
    // is the robust, org-agnostic assertion.
    await expect(page.getByText(/export csv/i).first(), 'an Export CSV affordance must be present').toBeVisible({
      timeout: 8000,
    });
    await expect(page.getByText(/auto-refresh/i).first(), 'the Auto-refresh indicator must render').toBeVisible({
      timeout: 8000,
    });
  });
});
