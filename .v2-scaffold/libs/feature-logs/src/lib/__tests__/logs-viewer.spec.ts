/**
 * Playwright E2E for `LogsViewerComponent`.
 *
 * Doctrine markers:
 *   - Starts at homepage, navigates by UI actions only (per Hard Gate).
 *   - Asserts WS-driven first-line render in < 500 ms.
 *   - Pause halts auto-scroll; level filter hides off-level lines;
 *     search highlights matches.
 *
 * The control-plane exposes the viewer at `/admin/sites/:slug/logs`.
 */
import { expect, test } from '@playwright/test';

test.describe('LogsViewerComponent', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: /sites/i }).click();
    await page.getByRole('link', { name: /demo-site/i }).click();
    await page.getByRole('tab', { name: /logs/i }).click();
    await expect(page.getByTestId('logs-viewer')).toBeVisible();
  });

  test('renders first WS line within 500 ms', async ({ page }) => {
    const started = Date.now();
    await expect(
      page.locator('[data-testid="logs-line"]').first(),
    ).toBeVisible({ timeout: 500 });
    expect(Date.now() - started).toBeLessThan(500);
  });

  test('pause stops auto-scroll', async ({ page }) => {
    const before = await page
      .locator('[data-testid="logs-line"]')
      .count();
    await page.getByTestId('logs-pause-btn').click();
    await page.waitForTimeout(750);
    const after = await page
      .locator('[data-testid="logs-line"]')
      .count();
    expect(after).toBe(before);
  });

  test('level filter hides off-level lines', async ({ page }) => {
    await page.getByTestId('logs-level-info').click(); // toggle off
    await page.getByTestId('logs-level-error').click(); // ensure on
    await page.waitForTimeout(400);
    const offLevel = await page
      .locator('[data-testid="logs-line"][data-level="info"]')
      .count();
    expect(offLevel).toBe(0);
  });

  test('search highlights matches', async ({ page }) => {
    await page.getByTestId('logs-search-input').fill('error');
    await page.waitForTimeout(350);
    await expect(
      page.locator('[data-testid="logs-line"] mark').first(),
    ).toBeVisible();
  });
});
