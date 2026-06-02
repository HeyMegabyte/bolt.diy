/**
 * @module e2e/contact-form
 *
 * The public contact form (rendered by SearchComponent at /search#contact-section;
 * /contact 301-redirects here). Exercises the required-field VALIDATION path only
 * — it deliberately never submits a valid message, since a real submit sends an
 * email + owner notification (Resend + Novu) and would spam the inbox.
 *
 * Covers the interactive-state gap the static axe/reflow sweeps can't: real user
 * action (click submit) → error toast → form not cleared/submitted.
 *
 * Run: npx playwright test --config=playwright.prod.config.ts contact-form
 */
import { test, expect } from '@playwright/test';

test.describe('public contact form — validation (no real submit)', () => {
  test.describe.configure({ retries: 2 });

  test.beforeEach(async ({ page }) => {
    await page.goto('/search', { waitUntil: 'load' });
    await page.evaluate(() => document.getElementById('contact-section')?.scrollIntoView({ block: 'center' }));
    await expect(page.locator('#contact-section form')).toBeVisible({ timeout: 30000 });
  });

  test('empty submit shows the required-fields error toast and does not submit', async ({ page }) => {
    test.setTimeout(45000);
    await page.locator('#contact-section button[type="submit"]').click();
    const toast = page.locator('[data-testid="toast-item"] .toast-text').first();
    await expect(toast).toBeVisible({ timeout: 5000 });
    await expect(toast).toHaveText(/fill in all required fields/i);
    // Fields untouched → nothing was sent.
    await expect(page.locator('#contact-name')).toHaveValue('');
    await expect(page.locator('#contact-email')).toHaveValue('');
  });

  test('partial fill (name+email, no message) still blocks submit', async ({ page }) => {
    test.setTimeout(45000);
    await page.fill('#contact-name', 'Test Person');
    await page.fill('#contact-email', 'test@example.com');
    await page.locator('#contact-section button[type="submit"]').click();
    const toast = page.locator('[data-testid="toast-item"] .toast-text').first();
    await expect(toast).toBeVisible({ timeout: 5000 });
    await expect(toast).toHaveText(/fill in all required fields/i);
    // Still on /search, message empty → not submitted.
    await expect(page.locator('#contact-message')).toHaveValue('');
  });

  test('toast region is aria-live (announced to screen readers)', async ({ page }) => {
    test.setTimeout(45000);
    await page.locator('#contact-section button[type="submit"]').click();
    await expect(page.locator('[data-testid="toast-item"]').first()).toBeVisible({ timeout: 5000 });
    const live = await page.locator('.toast-container').first().getAttribute('aria-live');
    expect(live, 'toast container must announce via aria-live').toBe('polite');
  });
});
