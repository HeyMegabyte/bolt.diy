/**
 * Playwright E2E for `SqlConsoleComponent`.
 *
 * Asserts:
 *   - Editor surface mounts (Monaco wrapper or fallback textarea both
 *     carry `data-testid="sql-editor-input"`).
 *   - Schema autocomplete list populates from `SqlService.introspectSchema$`.
 *   - Safe-mode blocks `DROP TABLE` without explicit second-click confirm.
 *   - Results render in ag-grid.
 *   - CSV export triggers a download.
 */
import { expect, test } from '@playwright/test';

test.describe('SqlConsoleComponent', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: /sites/i }).click();
    await page.getByRole('link', { name: /demo-site/i }).click();
    await page.getByRole('tab', { name: /sql/i }).click();
    await expect(page.getByTestId('sql-console')).toBeVisible();
  });

  test('editor mounts and autocompletes from schema', async ({ page }) => {
    await expect(page.getByTestId('sql-editor-input')).toBeVisible();
    const completions = page.getByTestId('sql-completions');
    await expect(completions).toBeVisible();
    await expect(completions.locator('li').first()).toBeVisible();
  });

  test('safe-mode blocks DROP TABLE on first click', async ({ page }) => {
    await page
      .getByTestId('sql-editor-input')
      .fill('DROP TABLE users;');
    await page.getByTestId('sql-run-btn').click();
    await expect(page.getByTestId('sql-error')).toContainText(/safe-mode/i);
    await expect(page.getByTestId('sql-results')).toHaveCount(0);
  });

  test('safe-mode allows DROP TABLE on confirmation click', async ({ page }) => {
    await page
      .getByTestId('sql-editor-input')
      .fill('DROP TABLE users;');
    await page.getByTestId('sql-run-btn').click();
    await page.getByTestId('sql-run-btn').click();
    // server may reject with 403; we only assert the safe-mode gate yielded.
    await expect(page.getByTestId('sql-error')).not.toContainText(/safe-mode/i, {
      timeout: 2000,
    });
  });

  test('SELECT renders ag-grid results', async ({ page }) => {
    await page
      .getByTestId('sql-editor-input')
      .fill('SELECT 1 AS hello;');
    await page.getByTestId('sql-run-btn').click();
    await expect(page.getByTestId('sql-results-grid')).toBeVisible();
  });

  test('CSV export triggers download', async ({ page }) => {
    await page
      .getByTestId('sql-editor-input')
      .fill('SELECT 1 AS hello;');
    await page.getByTestId('sql-run-btn').click();
    await expect(page.getByTestId('sql-results-grid')).toBeVisible();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('sql-export-csv').click(),
    ]);
    expect(download.suggestedFilename()).toBe('results.csv');
  });
});
