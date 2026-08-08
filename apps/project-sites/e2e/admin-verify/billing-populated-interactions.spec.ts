/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — comprehensive Billing coverage: the
 * section renders REAL populated plan/entitlement data (the mandate's core) and its
 * tab navigation works, WITHOUT ever touching a money-path button (upgrade /
 * checkout / cancel / topup are never clicked).
 *
 * Billing (verified request-shape CLEAN + populated in P0.56) is a tabbed section:
 * a plan pill + `subscription-plan` + `entitlement-{custom_domains,seats,analytics}`
 * (the REAL resolver shape per board 06e — the pre-06e `{sites,storage_gb}` testids were
 * removed) on the Subscription tab, and a `role="tablist"` of `billing-tab-*` tabs
 * with `billing-tab-panel-*` panels. Tabs are discovered at runtime (no hard-coded
 * ids). Real session (E2E_API_KEY) → the e2e-test-org is a real FREE plan.
 *
 * @see {@link ../helpers/realdata.ts}
 * @see {@link ./admin-tabs.spec.ts}
 */
import { test, expect } from '../fixtures.js';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';

const gotoBilling = async (page: import('@playwright/test').Page) => {
  await setupRealDataPage(page, { passthrough: /\/api\// });
  await page.goto('/admin/billing', { waitUntil: 'domcontentloaded' });
  await page
    .locator('[data-testid="subscription-plan"]')
    .waitFor({ state: 'visible', timeout: 15000 });
};

test.describe('Admin · billing populated + interactions (P0-ADMIN)', () => {
  test('renders REAL plan + entitlement data (populated, not empty/stub)', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await gotoBilling(page);

    // The current-plan pill shows a real plan label.
    const planPill = page.locator('[aria-label="Current plan"]');
    await expect(planPill).toBeVisible();
    await expect(planPill, 'the plan pill must name a real plan').toHaveText(
      /free|pro|business|enterprise/i,
    );

    // The subscription card names the plan with the FRIENDLY label (planLabel), matching the
    // pill above — NOT the raw D1 enum. A loose /\w/ here let the raw 'paid' enum leak into the
    // PLAN field (fixed 2026-08-08: line 142 now uses planLabel()); assert the human label so
    // the raw-enum leak can't regress.
    await expect(
      page.locator('[data-testid="subscription-plan"]'),
      'the subscription plan must show the friendly label, not the raw enum',
    ).toHaveText(/free|pro|business|enterprise/i);

    // Entitlements render the REAL resolver shape (board 06e): custom_domains + seats as
    // numeric rolling counters (0 is valid for a fresh Free org — populated real data, NOT
    // an empty/stub state), and analytics as an "Included" / "—" indicator.
    for (const key of ['custom_domains', 'seats']) {
      const ent = page.locator(`[data-testid="entitlement-${key}"]`);
      await expect(ent, `entitlement ${key} must render`).toBeVisible({ timeout: 10000 });
      await expect(ent, `entitlement ${key} must be a real number`).toHaveText(/\d/);
    }
    const analytics = page.locator('[data-testid="entitlement-analytics"]');
    await expect(analytics, 'entitlement analytics must render').toBeVisible({ timeout: 10000 });
    await expect(analytics, 'entitlement analytics shows a real state (Included / —)').toHaveText(
      /\S/,
    );
  });

  test('every billing tab switches and renders its panel', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await gotoBilling(page);

    const tabs = page.locator('[data-testid^="billing-tab-"]');
    const count = await tabs.count();
    expect(count, 'billing must expose multiple section tabs').toBeGreaterThan(1);

    for (let i = 0; i < count; i++) {
      const tab = tabs.nth(i);
      const id = (await tab.getAttribute('data-testid'))!.replace('billing-tab-', '');
      await tab.click();
      await expect(tab, `tab ${id} becomes selected`).toHaveAttribute('aria-selected', 'true', {
        timeout: 6000,
      });
      await expect(
        page.locator(`#billing-tab-panel-${id}`),
        `tab ${id} reveals its panel`,
      ).toBeVisible({ timeout: 6000 });
    }
  });

  test('the subscription card shows a real plan + billing status (no empty/stub)', async ({
    page,
  }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await gotoBilling(page);

    // The subscription card renders (not an empty/error placeholder).
    await expect(
      page.locator('[data-testid="subscription-card"]'),
      'the subscription card must render',
    ).toBeVisible({
      timeout: 10000,
    });
    // The renewal/period field is always populated ("No renewal" for Free, or a date).
    await expect(
      page.locator('[data-testid="subscription-period-end"]'),
      'a renewal/period field renders (e.g. "No renewal" for Free)',
    ).toHaveText(/\w/);
  });

  test('the Free plan surfaces its plan-gated Upgrade CTA (subscription card, not clicked)', async ({
    page,
  }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await gotoBilling(page);

    // `plan()` is derived from /billing/subscription (status==='active' ? 'pro' : 'free').
    // e2e-test-org has no active sub → Free → the subscription card shows the Upgrade CTA
    // and NOT the Pro-only "Manage billing" control. Scope to the subscription card so we
    // don't collide with the SECOND upgrade CTA in the plan-comparison card below it.
    // Never clicked — upgrade() opens a real Stripe checkout (money path).
    const card = page.locator('[data-testid="subscription-card"]');
    const upgrade = card.getByRole('button', { name: /upgrade to pro/i });
    await expect(upgrade, 'a Free plan must surface the Upgrade CTA').toBeVisible({
      timeout: 8000,
    });
    await expect(upgrade, 'the Upgrade CTA must be actionable').toBeEnabled();
    await expect(
      card.getByRole('button', { name: /manage billing/i }),
      'the Pro-only "Manage billing" control must NOT show on a Free plan',
    ).toHaveCount(0);
  });
});
