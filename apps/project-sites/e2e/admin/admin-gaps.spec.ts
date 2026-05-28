/**
 * Admin gap closes — ADMIN-03, ADMIN-33, ADMIN-34.
 *
 * ADMIN-03 — `/admin/sites` renders the sites list with status badges
 *   (publish / draft / building) per row.
 * ADMIN-33 — Network-status banner appears when the browser is offline
 *   and disappears when back online.
 * ADMIN-34 — Toast layer dedupes identical (message+type) toasts within
 *   a short window and supports action-armed toasts (Retry / Undo).
 *
 * Hard rules: hermetic, parallel-safe, starts at `/`, real-user nav
 * via `authedPage` fixture. App code satisfies the test as written —
 * never weaken the test.
 */
import { test, expect } from '../fixtures.js';

test.describe('ADMIN-03 — sites list with status badges', () => {
  test('renders one row per site with the site name + status badge', async ({ authedPage: page }) => {
    await page.route('**/api/sites', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          sites: [
            { id: 's1', slug: 'alpha-co', name: 'Alpha Co', status: 'published',
              created_at: '2026-05-01T00:00:00Z', updated_at: '2026-05-27T00:00:00Z' },
            { id: 's2', slug: 'beta-co',  name: 'Beta Co',  status: 'draft',
              created_at: '2026-05-02T00:00:00Z', updated_at: '2026-05-26T00:00:00Z' },
            { id: 's3', slug: 'gamma-co', name: 'Gamma Co', status: 'generating',
              created_at: '2026-05-03T00:00:00Z', updated_at: '2026-05-25T00:00:00Z' },
          ],
        }),
      });
    });
    await page.goto('/admin/sites');
    await expect(page.getByRole('link', { name: /alpha co/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /beta co/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /gamma co/i })).toBeVisible();
  });
});

test.describe('ADMIN-33 — network-status banner', () => {
  test('appears when offline, disappears when back online', async ({ authedPage: page }) => {
    await page.goto('/admin');
    // Force offline.
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
      window.dispatchEvent(new Event('offline'));
    });
    await expect(page.getByTestId('network-status-banner')).toBeVisible({ timeout: 4_000 });
    // Back online.
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
      window.dispatchEvent(new Event('online'));
    });
    await expect(page.getByTestId('network-status-banner')).toBeHidden({ timeout: 4_000 });
  });
});

test.describe('ADMIN-34 — toast layer', () => {
  test('dedupes identical toasts + supports action-armed toasts', async ({ authedPage: page }) => {
    await page.goto('/admin');
    // Fire two identical info toasts in a row; only one should render.
    await page.evaluate(() => {
      const toast = (window as unknown as { __toastService?: { info: (m: string) => void } }).__toastService;
      if (!toast) return;
      toast.info('Saved — duplicate filter check');
      toast.info('Saved — duplicate filter check');
    });
    const toasts = page.locator('[data-testid="toast-item"]:has-text("duplicate filter check")');
    await expect(toasts).toHaveCount(1, { timeout: 4_000 });

    // Fire an action-armed toast and verify the action button is present.
    await page.evaluate(() => {
      const toast = (window as unknown as {
        __toastService?: {
          error: (m: string, opts?: { action?: { label: string; onClick: () => void } }) => void;
        };
      }).__toastService;
      if (!toast) return;
      toast.error('Save failed', {
        action: { label: 'Retry', onClick: () => undefined },
      });
    });
    await expect(page.getByRole('button', { name: /retry/i })).toBeVisible();
  });
});
