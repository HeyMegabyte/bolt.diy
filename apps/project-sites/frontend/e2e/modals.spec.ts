/**
 * Modal E2E tests.
 *
 * Covers: Details, Deploy, Files, Domains, Logs, Status, Reset, Delete modals.
 * Tests open/close, basic content rendering, and key interactions.
 */
import { test, expect } from './fixtures.js';

/** Helper: get the first site card and wait for it to be visible */
async function getFirstCard(page: import('@playwright/test').Page) {
  const card = page.locator('.site-card').first();
  await expect(card).toBeVisible({ timeout: 5000 });
  return card;
}

/** Helper: open the More dropdown on a card, then click a button inside it */
async function clickMoreItem(card: import('@playwright/test').Locator, testId: string) {
  await card.locator('[data-testid="more-btn"]').click();
  await card.locator(`[data-testid="${testId}"]`).click();
}

test.describe('Details Modal', () => {
  test('opens and shows site details heading', async ({ authedPage: page }) => {
    await page.goto('/admin');
    const card = await getFirstCard(page);
    await clickMoreItem(card, 'details-btn');
    await expect(page.locator('ion-modal ion-title')).toContainText('Site Details', { timeout: 3000 });
  });

  test('shows business name in details', async ({ authedPage: page }) => {
    await page.goto('/admin');
    const card = await getFirstCard(page);
    await clickMoreItem(card, 'details-btn');
    await expect(page.locator('ion-modal')).toContainText('Business Name', { timeout: 3000 });
  });

  test('close button dismisses modal', async ({ authedPage: page }) => {
    await page.goto('/admin');
    const card = await getFirstCard(page);
    await clickMoreItem(card, 'details-btn');
    await expect(page.locator('ion-modal ion-title')).toContainText('Site Details', { timeout: 3000 });
    await page.locator('ion-modal ion-button', { hasText: 'Close' }).click();
    await expect(page.locator('ion-modal ion-title')).not.toBeVisible({ timeout: 3000 });
  });
});

test.describe('Files Modal', () => {
  test('opens and shows File Editor heading', async ({ authedPage: page }) => {
    await page.goto('/admin');
    const card = await getFirstCard(page);
    await card.locator('[data-testid="files-btn"]').click();
    await expect(page.locator('ion-modal ion-title')).toContainText('File Editor', { timeout: 3000 });
  });

  test('shows file tree panel', async ({ authedPage: page }) => {
    await page.goto('/admin');
    const card = await getFirstCard(page);
    await card.locator('[data-testid="files-btn"]').click();
    await expect(page.locator('ion-modal .file-tree')).toBeVisible({ timeout: 3000 });
  });

  test('shows editor panel', async ({ authedPage: page }) => {
    await page.goto('/admin');
    const card = await getFirstCard(page);
    await card.locator('[data-testid="files-btn"]').click();
    await expect(page.locator('ion-modal .file-editor')).toBeVisible({ timeout: 3000 });
  });
});

test.describe('Domains Modal', () => {
  test('opens and shows Domain Management heading', async ({ authedPage: page }) => {
    await page.goto('/admin');
    const card = await getFirstCard(page);
    await card.locator('[data-testid="domains-btn"]').click();
    await expect(page.locator('ion-modal ion-title')).toContainText('Domain Management', { timeout: 3000 });
  });

  test('shows Your Domains and Connect Domain tabs', async ({ authedPage: page }) => {
    await page.goto('/admin');
    const card = await getFirstCard(page);
    await card.locator('[data-testid="domains-btn"]').click();
    await expect(page.locator('ion-modal ion-segment-button', { hasText: 'Your Domains' })).toBeVisible({ timeout: 3000 });
    await expect(page.locator('ion-modal ion-segment-button', { hasText: 'Connect Domain' })).toBeVisible();
  });

  test('Connect Domain tab shows setup instructions', async ({ authedPage: page }) => {
    await page.goto('/admin');
    const card = await getFirstCard(page);
    await card.locator('[data-testid="domains-btn"]').click();
    await page.locator('ion-modal ion-segment-button', { hasText: 'Connect Domain' }).click();
    await expect(page.locator('ion-modal .connect-steps')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('ion-modal .connect-steps')).toContainText('How to connect your domain');
  });

  test('shows Domain Search tab', async ({ authedPage: page }) => {
    await page.goto('/admin');
    const card = await getFirstCard(page);
    await card.locator('[data-testid="domains-btn"]').click();
    await expect(page.locator('ion-modal ion-segment-button', { hasText: 'Domain Search' })).toBeVisible({ timeout: 3000 });
  });
});

test.describe('Logs Modal', () => {
  test('opens and shows Build Logs heading', async ({ authedPage: page }) => {
    await page.goto('/admin');
    const card = await getFirstCard(page);
    await clickMoreItem(card, 'logs-btn');
    await expect(page.locator('ion-modal ion-title')).toContainText('Build Logs', { timeout: 3000 });
  });

  test('shows Copy for AI button', async ({ authedPage: page }) => {
    await page.goto('/admin');
    const card = await getFirstCard(page);
    await clickMoreItem(card, 'logs-btn');
    await expect(page.locator('ion-modal ion-button', { hasText: 'Copy for AI' })).toBeVisible({ timeout: 3000 });
  });

  test('shows Refresh button', async ({ authedPage: page }) => {
    await page.goto('/admin');
    const card = await getFirstCard(page);
    await clickMoreItem(card, 'logs-btn');
    await expect(page.locator('ion-modal ion-button', { hasText: 'Refresh' })).toBeVisible({ timeout: 3000 });
  });

  test('shows timeline entries for logs', async ({ authedPage: page }) => {
    await page.goto('/admin');
    const card = await getFirstCard(page);
    await clickMoreItem(card, 'logs-btn');
    await expect(page.locator('ion-modal .timeline-entry').first()).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Status Modal', () => {
  test('opens and shows Build Status heading', async ({ authedPage: page }) => {
    await page.goto('/admin');
    const card = await getFirstCard(page);
    await clickMoreItem(card, 'status-btn');
    await expect(page.locator('ion-modal ion-title')).toContainText('Build Status', { timeout: 3000 });
  });

  test('shows terminal-style status display', async ({ authedPage: page }) => {
    await page.goto('/admin');
    const card = await getFirstCard(page);
    await clickMoreItem(card, 'status-btn');
    await expect(page.locator('ion-modal .status-terminal')).toBeVisible({ timeout: 3000 });
  });
});

test.describe('Deploy Modal', () => {
  test('opens and shows Deploy ZIP heading', async ({ authedPage: page }) => {
    await page.goto('/admin');
    const card = await getFirstCard(page);
    await clickMoreItem(card, 'deploy-btn');
    await expect(page.locator('ion-modal ion-title')).toContainText('Deploy ZIP', { timeout: 3000 });
  });

  test('shows drag and drop zone', async ({ authedPage: page }) => {
    await page.goto('/admin');
    const card = await getFirstCard(page);
    await clickMoreItem(card, 'deploy-btn');
    await expect(page.locator('ion-modal .deploy-zone')).toBeVisible({ timeout: 3000 });
  });

  test('shows Browse Files button', async ({ authedPage: page }) => {
    await page.goto('/admin');
    const card = await getFirstCard(page);
    await clickMoreItem(card, 'deploy-btn');
    await expect(page.locator('ion-modal .browse-btn')).toBeVisible({ timeout: 3000 });
  });

  test('deploy button is disabled without file', async ({ authedPage: page }) => {
    await page.goto('/admin');
    const card = await getFirstCard(page);
    await clickMoreItem(card, 'deploy-btn');
    const deployBtn = page.locator('ion-modal [data-testid="deploy-submit-btn"]');
    await expect(deployBtn).toBeVisible({ timeout: 3000 });
    await expect(deployBtn).toBeDisabled();
  });
});

test.describe('Reset Modal', () => {
  test('opens and shows Reset & Rebuild heading', async ({ authedPage: page }) => {
    await page.goto('/admin');
    const card = await getFirstCard(page);
    await clickMoreItem(card, 'reset-btn');
    await expect(page.locator('ion-modal ion-title')).toContainText('Reset & Rebuild', { timeout: 3000 });
  });

  test('shows additional context textarea', async ({ authedPage: page }) => {
    await page.goto('/admin');
    const card = await getFirstCard(page);
    await clickMoreItem(card, 'reset-btn');
    await expect(page.locator('ion-modal textarea')).toBeVisible({ timeout: 3000 });
  });

  test('shows Reset & Rebuild submit button', async ({ authedPage: page }) => {
    await page.goto('/admin');
    const card = await getFirstCard(page);
    await clickMoreItem(card, 'reset-btn');
    await expect(page.locator('ion-modal ion-button[color="warning"]')).toBeVisible({ timeout: 3000 });
  });
});

test.describe('Delete Modal', () => {
  test('opens and shows Delete Site heading', async ({ authedPage: page }) => {
    await page.goto('/admin');
    const card = await getFirstCard(page);
    await clickMoreItem(card, 'delete-btn');
    await expect(page.locator('ion-modal ion-title')).toContainText('Delete Site', { timeout: 3000 });
  });

  test('shows warning message', async ({ authedPage: page }) => {
    await page.goto('/admin');
    const card = await getFirstCard(page);
    await clickMoreItem(card, 'delete-btn');
    await expect(page.locator('ion-modal .delete-warning h3')).toContainText('cannot be undone', { timeout: 3000 });
  });

  test('delete button is disabled without confirmation', async ({ authedPage: page }) => {
    await page.goto('/admin');
    const card = await getFirstCard(page);
    await clickMoreItem(card, 'delete-btn');
    const deleteBtn = page.locator('ion-modal ion-button[color="danger"]');
    await expect(deleteBtn).toBeVisible({ timeout: 3000 });
    await expect(deleteBtn).toHaveAttribute('disabled', '');
  });
});
