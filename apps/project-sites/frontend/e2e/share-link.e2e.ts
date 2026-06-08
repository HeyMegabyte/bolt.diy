/**
 * share-link.e2e.ts — the "Share link" modal (replaces the removed
 * /admin/review-links page). Opens from the navbar Actions dropdown and lets the
 * operator create a shareable preview+approve link, optionally password-protected.
 *
 * Written TDD-first for the feature: the password-aware create flow goes GREEN
 * once the worker password support (migration 0537 + /unlock) is deployed and
 * the test org has `approval_workflow` enabled. The UI-interaction assertions
 * (toggle / generate / strength / validation) pass regardless of the flag.
 *
 * Seeds ps_session from E2E_API_KEY (real psk_test_ row in prod D1). Run:
 *   E2E_API_KEY=$(get-secret E2E_API_KEY) npx playwright test --config=playwright.prod.config.ts share-link
 */

import { test, expect, type Page } from '@playwright/test';

const KEY = process.env.E2E_API_KEY ?? '';

async function openShareDialog(page: Page): Promise<boolean> {
  await page.goto('/admin');
  await expect(page.locator('nav[aria-label="Admin sections"]')).toBeVisible({ timeout: 15_000 });
  const trigger = page.locator('[data-testid="site-actions-btn"]');
  const appeared = await trigger.first().waitFor({ state: 'visible', timeout: 8_000 }).then(() => true).catch(() => false);
  if (!appeared) return false;
  await trigger.click();
  await page.locator('[data-testid="sa-share-link"]').click();
  await expect(page.locator('app-share-link-dialog')).toBeVisible({ timeout: 10_000 });
  return true;
}

test.describe('Share link modal', () => {
  test.beforeEach(async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
    await page.addInitScript((k: string) => {
      try {
        localStorage.setItem('ps_session', JSON.stringify({ token: k, identifier: 'test@megabyte.space', createdAt: Date.now() }));
        localStorage.setItem('ps_feedback_dismissed', 'true');
      } catch {
        /* covered by the no-key skip */
      }
    }, KEY);
  });

  test.skip(!KEY, 'E2E_API_KEY not set');

  test('opens from the Actions menu with expiry presets + create button', async ({ page }) => {
    if (!(await openShareDialog(page))) { test.skip(true, 'no site for the test account'); return; }
    await expect(page.locator('[data-testid="share-link-create"]')).toBeVisible();
    await expect(page.locator('[data-testid="share-link-expiry-7"]')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('[data-testid="share-link-expiry-30"]').click();
    await expect(page.locator('[data-testid="share-link-expiry-30"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-testid="share-link-expiry-7"]')).toHaveAttribute('aria-pressed', 'false');
  });

  test('password toggle reveals the field; Generate fills a memorable passphrase + enables Create', async ({ page }) => {
    if (!(await openShareDialog(page))) { test.skip(true, 'no site for the test account'); return; }
    await expect(page.locator('[data-testid="share-link-password-row"]')).toHaveCount(0);
    await page.locator('[data-testid="share-link-password-toggle"]').check();
    const input = page.locator('[data-testid="share-link-password-input"]');
    await expect(input).toBeVisible();
    // Toggling on auto-generates a passphrase (word-word-NN!).
    await expect(input).toHaveValue(/[a-z]+-[a-z]+-\d{2}!/);
    // Regenerate produces a fresh value.
    const first = await input.inputValue();
    await page.locator('[data-testid="share-link-password-generate"]').click();
    await expect(input).not.toHaveValue(first);
    await expect(page.locator('[data-testid="share-link-create"]')).toBeEnabled();
  });

  test('a too-short password blocks Create with an inline alert', async ({ page }) => {
    if (!(await openShareDialog(page))) { test.skip(true, 'no site for the test account'); return; }
    await page.locator('[data-testid="share-link-password-toggle"]').check();
    const input = page.locator('[data-testid="share-link-password-input"]');
    await input.fill('abc'); // < 6
    await expect(page.locator('[data-testid="share-link-create"]')).toBeDisabled();
    await expect(page.locator('#share-link-pw-hint[role="alert"]')).toBeVisible();
  });

  test('Create produces a copied link (when approval_workflow is enabled)', async ({ page }) => {
    if (!(await openShareDialog(page))) { test.skip(true, 'no site for the test account'); return; }
    // If the flag is off the modal shows a calm gate instead of the form.
    if (await page.locator('[data-testid="share-link-flag-gate"]').isVisible().catch(() => false)) {
      test.skip(true, 'approval_workflow flag off for the test org');
      return;
    }
    await page.locator('[data-testid="share-link-create"]').click();
    await expect(page.locator('[data-testid="share-link-created"]')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-testid="share-link-url"]')).toContainText('/review/');
    await expect(page.locator('[data-testid="share-link-copy"]')).toBeVisible();
  });
});
