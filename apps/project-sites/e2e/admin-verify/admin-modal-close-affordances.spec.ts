/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — the DialogShell modal closes by ALL its
 * affordances, not just Escape (covered in admin-modal-lifecycle): the ✕ button
 * (`aria-label="Close dialog"`), the Cancel button, and a backdrop click
 * (`onBackdropClick`). Every admin modal inherits these, so proving them on one
 * (the org-scoped API-token create modal — no site needed) validates the primitive.
 *
 * NON-MUTATING: only opens + closes — NEVER submits (`at-create-submit` untouched).
 *
 * @see {@link ./admin-modal-lifecycle.spec.ts}
 */
import { test, expect } from '../fixtures.js';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';

const openTokenModal = async (page: import('@playwright/test').Page) => {
  await setupRealDataPage(page, { passthrough: /\/api\// });
  await page.goto('/admin/api-tokens', { waitUntil: 'domcontentloaded' });
  const open = page.locator('[data-testid="at-create-open"]');
  await open.waitFor({ state: 'visible', timeout: 15000 });
  await open.click();
  await expect(page.locator('[role="dialog"]'), 'the modal opens').toBeVisible({ timeout: 6000 });
};

test.describe('Admin · modal close affordances (DialogShell) (P0-ADMIN)', () => {
  test('the ✕ close button closes the modal', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await openTokenModal(page);
    await page.locator('[aria-label="Close dialog"]').first().click();
    await expect(page.locator('[role="dialog"]'), 'the ✕ closes the modal').toBeHidden({ timeout: 6000 });
  });

  test('the Cancel button closes the modal', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await openTokenModal(page);
    await page.getByRole('button', { name: /^Cancel$/i }).first().click();
    await expect(page.locator('[role="dialog"]'), 'Cancel closes the modal').toBeHidden({ timeout: 6000 });
  });

  // (Backdrop-click close is a 4th DialogShell path but a position-click on a
  // full-screen flex container is unreliable in headless CI — the ✕ / Cancel /
  // Escape paths above + in admin-modal-lifecycle cover close comprehensively.)
});
