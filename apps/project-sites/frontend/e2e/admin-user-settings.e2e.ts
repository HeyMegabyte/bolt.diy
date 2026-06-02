/**
 * @module e2e/admin-user-settings
 *
 * Regression guard: the Sessions section (`/admin/user`) once called the
 * non-existent worker route `/api/admin/sessions` via ApiService on load,
 * which returned the SPA index.html → parse failure → a spurious
 * "Can't reach the server" toast on every visit. The fix uses a silent raw
 * HttpClient fetch with a graceful current-device fallback. This asserts the
 * section renders the current device WITHOUT a server-error toast.
 *
 * Seeds `ps_session` from `E2E_API_KEY`. Run:
 *   E2E_API_KEY=… npx playwright test --config=playwright.prod.config.ts admin-user-settings
 */
import { test, expect, type Page } from '@playwright/test';

const KEY = process.env.E2E_API_KEY ?? '';

async function seed(page: Page): Promise<void> {
  await page.addInitScript((k: string) => {
    try {
      localStorage.setItem('ps_session', JSON.stringify({ token: k, identifier: 'test@megabyte.space', createdAt: Date.now() }));
    } catch { /* private mode */ }
  }, KEY);
}

test.describe('admin /admin/user — Sessions section is toast-clean', () => {
  test.skip(!KEY, 'E2E_API_KEY not set');
  test.describe.configure({ retries: 2 });

  test('loads the Active sessions / current device with no server-error toast', async ({ page }) => {
    test.setTimeout(60000);
    await seed(page);
    await page.goto('/admin/user', { waitUntil: 'load' });
    await expect(page.locator('.admin-sidebar').first()).toBeVisible({ timeout: 30000 });
    // Section + current-device fallback render.
    await expect(page.getByText(/Active sessions/i).first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/This device/i).first()).toBeVisible({ timeout: 15000 });
    // Give any (incorrect) toast time to appear, then assert none of the
    // server-error toasts fired (the bug surfaced "Can't reach the server").
    await page.waitForTimeout(3000);
    const toasts = await page.locator('[data-testid="toast-item"]').allInnerTexts();
    const serverErrorToast = toasts.find((t) => /reach the server|resource wasn't found|unexpected error/i.test(t));
    expect(serverErrorToast, `unexpected server-error toast on /admin/user: ${toasts.join(' | ')}`).toBeUndefined();
  });
});
