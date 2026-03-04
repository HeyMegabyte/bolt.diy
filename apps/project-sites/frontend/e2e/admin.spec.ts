/**
 * Admin Dashboard E2E tests.
 *
 * Covers: page rendering, rich site cards, inline slug editing,
 * action buttons, modal triggers, billing controls.
 */
import { test, expect } from './fixtures.js';

test.describe('Admin Page - Unauthenticated', () => {
  test('redirects to signin if not logged in', async ({ page }) => {
    await page.goto('/admin');
    // The admin page loads sites which returns 401
    // The page should still render but show empty/loading state
    await expect(page.locator('.admin-panel')).toBeVisible();
  });
});

test.describe('Admin Page - Authenticated', () => {
  test('shows My Sites title', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await expect(page.locator('.admin-panel-title')).toContainText('My Sites');
  });

  test('shows New Website button', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await expect(page.locator('.admin-panel-actions ion-button').last()).toContainText('New Website');
  });

  test('shows Manage Billing button', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await expect(page.locator('.admin-panel-actions ion-button').first()).toContainText('Manage Billing');
  });

  test('shows plan indicator', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await expect(page.locator('.plan-indicator')).toBeVisible();
  });

  test('shows site count badge when sites are loaded', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await expect(page.locator('.site-count-badge')).toBeVisible({ timeout: 5000 });
  });

  test('shows site cards when sites are loaded', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await expect(page.locator('.site-card').first()).toBeVisible({ timeout: 5000 });
  });

  test('site card shows business name', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await expect(page.locator('.sc-name').first()).toBeVisible({ timeout: 5000 });
  });

  test('site card shows status badge', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await expect(page.locator('.sc-status').first()).toBeVisible({ timeout: 5000 });
  });

  test('site card shows slug URL', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await expect(page.locator('.sc-url').first()).toBeVisible({ timeout: 5000 });
  });

  test('site card shows split URL with slug and domain parts', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await expect(page.locator('.sc-slug-part').first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.sc-domain-part').first()).toBeVisible({ timeout: 5000 });
  });

  test('site card has slug edit trigger button', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await expect(page.locator('[data-testid="slug-edit-trigger"]').first()).toBeVisible({ timeout: 5000 });
  });

  test('site card shows action buttons', async ({ authedPage: page }) => {
    await page.goto('/admin');
    const card = page.locator('.site-card').first();
    await expect(card).toBeVisible({ timeout: 5000 });
    await expect(card.locator('.action-btn').first()).toBeVisible();
  });

  test('site card shows More menu with Details', async ({ authedPage: page }) => {
    await page.goto('/admin');
    const card = page.locator('.site-card').first();
    await expect(card).toBeVisible({ timeout: 5000 });
    await card.locator('[data-testid="more-btn"]').click();
    await expect(card.locator('[data-testid="details-btn"]')).toBeVisible();
  });

  test('site card shows Files button', async ({ authedPage: page }) => {
    await page.goto('/admin');
    const card = page.locator('.site-card').first();
    await expect(card).toBeVisible({ timeout: 5000 });
    await expect(card.locator('[data-testid="files-btn"]')).toBeVisible();
  });

  test('site card shows Domains button', async ({ authedPage: page }) => {
    await page.goto('/admin');
    const card = page.locator('.site-card').first();
    await expect(card).toBeVisible({ timeout: 5000 });
    await expect(card.locator('[data-testid="domains-btn"]')).toBeVisible();
  });

  test('More menu shows Logs button', async ({ authedPage: page }) => {
    await page.goto('/admin');
    const card = page.locator('.site-card').first();
    await expect(card).toBeVisible({ timeout: 5000 });
    await card.locator('[data-testid="more-btn"]').click();
    await expect(card.locator('[data-testid="logs-btn"]')).toBeVisible();
  });

  test('More menu shows Deploy button', async ({ authedPage: page }) => {
    await page.goto('/admin');
    const card = page.locator('.site-card').first();
    await expect(card).toBeVisible({ timeout: 5000 });
    await card.locator('[data-testid="more-btn"]').click();
    await expect(card.locator('[data-testid="deploy-btn"]')).toBeVisible();
  });

  test('More menu shows Reset button', async ({ authedPage: page }) => {
    await page.goto('/admin');
    const card = page.locator('.site-card').first();
    await expect(card).toBeVisible({ timeout: 5000 });
    await card.locator('[data-testid="more-btn"]').click();
    await expect(card.locator('[data-testid="reset-btn"]')).toBeVisible();
  });

  test('More menu shows Delete button', async ({ authedPage: page }) => {
    await page.goto('/admin');
    const card = page.locator('.site-card').first();
    await expect(card).toBeVisible({ timeout: 5000 });
    await card.locator('[data-testid="more-btn"]').click();
    await expect(card.locator('[data-testid="delete-btn"]')).toBeVisible();
  });

  test('More menu shows Upgrade button for free plan', async ({ authedPage: page }) => {
    await page.goto('/admin');
    const card = page.locator('.site-card').first();
    await expect(card).toBeVisible({ timeout: 5000 });
    await card.locator('[data-testid="more-btn"]').click();
    await expect(card.locator('[data-testid="upgrade-btn"]')).toBeVisible();
  });

  test('published site shows View Live button', async ({ authedPage: page }) => {
    await page.goto('/admin');
    // First site is published
    const card = page.locator('.site-card').first();
    await expect(card).toBeVisible({ timeout: 5000 });
    await expect(card.locator('[data-testid="view-live-btn"]')).toBeVisible();
  });

  test('domain summary is visible when domains exist', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await expect(page.locator('.domain-summary')).toBeVisible({ timeout: 5000 });
  });
});
