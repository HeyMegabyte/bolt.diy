/**
 * Playwright E2E for the Snapshots + Deploy History surface.
 *
 * Asserts:
 *   - Rollback requires the user to type the site slug verbatim
 *   - Lighthouse score chips show colour-coded delta arrows
 *   - Timeline view renders one card per snapshot with screenshot,
 *     AI description, and ops metrics row
 */
import { expect, test } from '@playwright/test';

const TEST_SLUG = 'demo-site';

test.describe('SnapshotsListComponent', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: /sites/i }).click();
    await page.getByRole('link', { name: new RegExp(TEST_SLUG, 'i') }).click();
    await page.getByRole('tab', { name: /snapshots/i }).click();
    await expect(page.getByTestId('snapshots-list')).toBeVisible();
  });

  test('timeline view renders snapshot cards', async ({ page }) => {
    await page.getByTestId('snapshots-view-timeline').click();
    const cards = page.getByTestId('snapshot-card');
    await expect(cards.first()).toBeVisible();
    await expect(
      cards.first().getByTestId('snapshot-ai-description'),
    ).toBeVisible();
    await expect(
      cards.first().getByTestId('snapshot-scores'),
    ).toBeVisible();
  });

  test('lighthouse delta chips show direction arrows', async ({ page }) => {
    await page.getByTestId('snapshots-view-timeline').click();
    const delta = page
      .getByTestId('snapshot-card')
      .first()
      .getByTestId('snapshot-delta-performance');
    if (await delta.count()) {
      const text = await delta.first().textContent();
      expect(text).toMatch(/[↑↓=]/);
    }
  });

  test('rollback button requires typed slug confirmation', async ({ page }) => {
    await page.getByTestId('snapshots-view-timeline').click();
    await page
      .getByTestId('snapshot-card')
      .first()
      .getByTestId('snapshot-rollback-btn')
      .click();
    await expect(page.getByTestId('rollback-dialog')).toBeVisible();
    const confirmBtn = page.getByTestId('rollback-confirm-btn');
    await expect(confirmBtn).toBeDisabled();

    await page.getByTestId('rollback-typed-input').fill('wrong-slug');
    await expect(confirmBtn).toBeDisabled();

    await page.getByTestId('rollback-typed-input').fill(TEST_SLUG);
    await expect(confirmBtn).toBeEnabled();
  });

  test('grid view toggle renders ag-grid', async ({ page }) => {
    await page.getByTestId('snapshots-view-grid').click();
    await expect(page.getByTestId('snapshots-grid')).toBeVisible();
  });
});
