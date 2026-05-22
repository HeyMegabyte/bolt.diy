/**
 * E2E coverage for the `/admin/audit` page's site-scoped view.
 *
 * Asserts that:
 *   1. The page renders the scope chip (`data-testid="audit-scope-chip"`),
 *   2. The chip names the currently-selected site (when one is selected),
 *   3. The ag-grid (`data-testid="audit-grid"`) is mounted and visible,
 *   4. Clicking × on the chip widens the scope to "All sites",
 *   5. The Refresh button + free-text search input are gone (auto-poll
 *      replaces them).
 *
 * Auth is mocked at the network layer via `page.route` — we don't run a real
 * sign-in flow here. The fixture from `./fixtures.js` blocks external CDNs
 * so the page boots fast in CI.
 */
import { test, expect } from './fixtures.js';

const SITE_ID = '11111111-1111-1111-1111-111111111111';
const SITE_SLUG = 'vitos-mens-salon';
const SITE_NAME = "Vito's Mens Salon";

test.describe('/admin/audit — site-scoped view', () => {
  test.beforeEach(async ({ page }) => {
    // Mock the auth + dashboard data endpoints so the admin shell boots
    // without hitting real D1. The token in localStorage mirrors what
    // AuthService persists post-magic-link verification.
    await page.addInitScript(() => {
      window.localStorage.setItem('ps_session_token', 'e2e-mock-token');
    });
    await page.route('**/api/auth/me', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: { user_id: 'user-1', org_id: 'org-1', email: 'test@megabyte.space' },
        }),
      }),
    );
    await page.route('**/api/sites', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            {
              id: SITE_ID,
              slug: SITE_SLUG,
              business_name: SITE_NAME,
              business_address: '74 N Beverwyck Rd, Lake Hiawatha, NJ 07034',
              status: 'published',
              plan: 'paid',
              created_at: '2026-05-01T00:00:00.000Z',
              updated_at: '2026-05-01T00:00:00.000Z',
            },
          ],
        }),
      }),
    );
    await page.route('**/api/domains/summary', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { total: 1, active: 1, pending: 0, failed: 0 } }),
      }),
    );
    await page.route('**/api/billing/subscription', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: null }),
      }),
    );
    await page.route('**/api/audit-logs**', (route) => {
      const url = new URL(route.request().url());
      const scoped = url.searchParams.get('site_slug') === SITE_SLUG;
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: scoped
            ? [
                {
                  id: 'a1',
                  action: 'site.deployed',
                  target_type: 'site',
                  target_id: SITE_ID,
                  actor_id: 'user-1',
                  metadata: { slug: SITE_SLUG },
                  request_id: 'req-1',
                  created_at: '2026-05-21T12:00:00.000Z',
                  site: SITE_SLUG,
                },
              ]
            : [
                {
                  id: 'a1',
                  action: 'site.deployed',
                  target_type: 'site',
                  target_id: SITE_ID,
                  actor_id: 'user-1',
                  metadata: { slug: SITE_SLUG },
                  request_id: 'req-1',
                  created_at: '2026-05-21T12:00:00.000Z',
                  site: SITE_SLUG,
                },
                {
                  id: 'a2',
                  action: 'billing.checkout_created',
                  target_type: 'org',
                  target_id: 'org-1',
                  actor_id: 'user-1',
                  metadata: null,
                  request_id: 'req-2',
                  created_at: '2026-05-21T11:00:00.000Z',
                  site: null,
                },
              ],
        }),
      });
    });
  });

  test('renders scope chip with the selected site name', async ({ page }) => {
    await page.goto('/admin/audit');
    const chip = page.locator('[data-testid="audit-scope-chip"]');
    await expect(chip).toBeVisible();
    await expect(chip).toContainText(SITE_NAME);
  });

  test('grid is mounted with data-testid="audit-grid"', async ({ page }) => {
    await page.goto('/admin/audit');
    await expect(page.locator('[data-testid="audit-grid"]')).toBeVisible();
  });

  test('Refresh button and free-text search input are gone', async ({ page }) => {
    await page.goto('/admin/audit');
    await expect(page.locator('button:has-text("Refresh")')).toHaveCount(0);
    await expect(page.locator('input[placeholder*="search" i]')).toHaveCount(0);
  });

  test('clicking × on the chip widens scope to all sites', async ({ page }) => {
    await page.goto('/admin/audit');
    const chip = page.locator('[data-testid="audit-scope-chip"]');
    await expect(chip).toContainText(SITE_NAME);
    await chip.click();
    await expect(page.locator('[data-testid="audit-scope-chip"]')).toContainText('All sites');
  });
});
