/**
 * E2E coverage for the merged Analytics surface (2026-06-23).
 *
 * "Live Events" was folded into Analytics as a deep-linkable tab. This spec
 * proves the merge end-to-end against the admin shell:
 *   - /admin/analytics renders the dashboard wrapper with Overview + Live Events
 *     tabs; Overview is the default.
 *   - Clicking the Live Events tab swaps the panel AND writes ?tab=live.
 *   - Clicking Overview swaps back (?tab=overview).
 *   - Deep-link /admin/analytics?tab=live lands directly on Live Events.
 *   - Legacy /admin/analytics-live redirects into ?tab=live.
 *   - The standalone "Live Events" sidebar nav item is gone.
 *   - No console errors across the interaction.
 *
 * Drives the UI via real clicks. Mocked API state (incl. the Live tab's
 * /api/analytics-data, /api/analytics-debug, /api/test-event) comes from
 * scripts/e2e_server.cjs. Auth via the default `authedPage` fixture.
 *
 * @see {@link ../src/app/pages/admin/sections/analytics-dashboard.component.ts}
 */
import { test, expect, type Page } from './fixtures';

function consoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return errors;
}

function filterNoise(errors: string[]): string[] {
  return errors.filter(
    (e) =>
      !e.includes('favicon') &&
      !e.includes('posthog') &&
      !e.includes('sentry') &&
      !e.includes('editor.projectsites.dev') &&
      !/net::ERR_|Failed to load resource/.test(e),
  );
}

test.describe('Analytics — merged Live Events tab', () => {
  test('renders the dashboard wrapper with Overview + Live Events tabs (Overview default)', async ({ authedPage: page }) => {
    await page.goto('/admin/analytics');

    await expect(page.getByTestId('analytics-dashboard')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'Analytics' })).toBeVisible();
    await expect(page.getByTestId('analytics-tab-overview')).toBeVisible();
    await expect(page.getByTestId('analytics-tab-live')).toBeVisible();

    // Overview is active by default; the Live Events panel is not mounted.
    await expect(page.getByTestId('analytics-tab-overview')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('analytics-tab-live')).toHaveAttribute('aria-selected', 'false');
    await expect(page.getByTestId('analytics-live')).toHaveCount(0);
  });

  test('clicking the Live Events tab swaps the panel and writes ?tab=live', async ({ authedPage: page }) => {
    await page.goto('/admin/analytics');

    await page.getByTestId('analytics-tab-live').click();

    await expect(page).toHaveURL(/[?&]tab=live/);
    await expect(page.getByTestId('analytics-live')).toBeVisible();
    await expect(page.getByTestId('analytics-tab-live')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('analytics-tab-overview')).toHaveAttribute('aria-selected', 'false');
    // The Live Events panel shows its own heading + the clean empty state.
    await expect(page.getByRole('heading', { level: 2, name: 'Live Events' })).toBeVisible();
    await expect(page.getByTestId('al-empty')).toBeVisible();
  });

  test('clicking Overview swaps back and writes ?tab=overview', async ({ authedPage: page }) => {
    await page.goto('/admin/analytics?tab=live');
    await expect(page.getByTestId('analytics-live')).toBeVisible();

    await page.getByTestId('analytics-tab-overview').click();
    await expect(page).toHaveURL(/[?&]tab=overview/);
    await expect(page.getByTestId('analytics-live')).toHaveCount(0);
    await expect(page.getByTestId('analytics-tab-overview')).toHaveAttribute('aria-selected', 'true');
  });

  test('deep-link ?tab=live lands directly on Live Events', async ({ authedPage: page }) => {
    await page.goto('/admin/analytics?tab=live');
    await expect(page.getByTestId('analytics-live')).toBeVisible();
    await expect(page.getByTestId('analytics-tab-live')).toHaveAttribute('aria-selected', 'true');
  });

  test('legacy /admin/analytics-live redirects into the ?tab=live tab', async ({ authedPage: page }) => {
    await page.goto('/admin/analytics-live');
    await expect(page).toHaveURL(/\/admin\/analytics\?tab=live/);
    await expect(page.getByTestId('analytics-live')).toBeVisible();
  });

  test('the standalone Live Events sidebar nav item is gone', async ({ authedPage: page }) => {
    await page.goto('/admin/analytics');
    // The Analytics nav anchor still exists; the Live Events one does not.
    await expect(page.locator('a[href$="/admin/analytics"]').first()).toBeVisible();
    await expect(page.locator('a[href$="/admin/analytics-live"]')).toHaveCount(0);
  });

  test('no console errors across an Overview ↔ Live Events round-trip', async ({ authedPage: page }) => {
    const errors = consoleErrors(page);
    await page.goto('/admin/analytics');
    await page.getByTestId('analytics-tab-live').click();
    await expect(page.getByTestId('analytics-live')).toBeVisible();
    await page.getByTestId('analytics-tab-overview').click();
    await expect(page.getByTestId('analytics-live')).toHaveCount(0);
    expect(filterNoise(errors)).toEqual([]);
  });
});
