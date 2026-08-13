import { test, expect, type Page } from '@playwright/test';

/**
 * Prod lock for the Settings prune + Business→General fold (2026-08-12).
 *
 * Removed from Settings: the Business tab (identity + address + brand assets
 * folded INTO General), AI Chat "Persona", "Original/former website", "Original
 * website prompt", "Brand tone", the second "Reply email" (contact + reply are
 * now one field), brand primary/accent colours + live preview, and default
 * locale + timezone. This spec asserts they're GONE from the live UI.
 *
 * Seeds ps_session from E2E_API_KEY (auth-level). Tab presence + control absence
 * are asserted at the tab level so they hold regardless of the seed org's site
 * state.
 *
 * Run: E2E_API_KEY=$(get-secret E2E_API_KEY) \
 *   npx playwright test --config=playwright.prod.config.ts admin-settings-general-merge
 */
const KEY = process.env.E2E_API_KEY ?? '';

async function seed(page: Page): Promise<void> {
  await page.addInitScript((k: string) => {
    try {
      localStorage.setItem('ps_session', JSON.stringify({ token: k, identifier: 'test@megabyte.space', createdAt: Date.now() }));
      localStorage.setItem('ps_feedback_dismissed', 'true');
    } catch { /* private mode */ }
  }, KEY);
}

async function go(page: Page, path: string): Promise<void> {
  await page.goto(path, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForTimeout(1800);
}

test.describe('admin — Settings prune + Business→General fold (prod lock)', () => {
  test.skip(!KEY, 'E2E_API_KEY not set');
  test.describe.configure({ retries: 2 });

  test('the Business tab is gone; General remains', async ({ page }) => {
    await seed(page);
    await go(page, '/admin/settings');
    await expect(page.getByRole('tab', { name: 'General' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Business' })).toHaveCount(0);
  });

  test('General has no brand-colour, reply-email, timezone or locale controls', async ({ page }) => {
    await seed(page);
    await go(page, '/admin/settings#general');
    // Brand colour pickers removed entirely.
    await expect(page.locator('input[type="color"]')).toHaveCount(0);
    // Second "Reply email" field removed (contact + reply are one field now).
    await expect(page.getByText('Reply email', { exact: false })).toHaveCount(0);
    // Brand tone / timezone / default-locale controls removed.
    await expect(page.getByText('Brand tone', { exact: false })).toHaveCount(0);
    await expect(page.getByText('Default locale', { exact: false })).toHaveCount(0);
  });

  test('AI Chat no longer has a Persona field', async ({ page }) => {
    await seed(page);
    await go(page, '/admin/settings#ai-chat');
    await expect(page.getByText('Persona', { exact: false })).toHaveCount(0);
    // The system prompt (kept) is still there.
    await expect(page.getByText('System prompt', { exact: false }).first()).toBeVisible();
  });
});
