/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — Snapshots section (`/admin/snapshots`).
 * Org-agnostic structural + interaction assertions (the E2E_API_KEY org may have
 * fewer/zero snapshots than brian) — one-of-state, presence-not-counts, modals
 * opened + Escaped but NEVER submitted (see [[admin-verify-e2e-authoring-gotchas]] #5).
 * Section map enumerated by a read-only agent (directive #1).
 *
 * @see {@link ../helpers/realdata.ts}
 */
import { test, expect } from '../fixtures.js';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';

const goto = async (page: import('@playwright/test').Page) => {
  await setupRealDataPage(page, { passthrough: /\/api\// });
  await page.goto('/admin/snapshots', { waitUntil: 'domcontentloaded' });
  await page
    .waitForFunction(() => (document.querySelector('main')?.innerText ?? '').trim().length > 150, { timeout: 15000 })
    .catch(() => {});
};

test.describe('Admin · Snapshots interactions (P0-ADMIN)', () => {
  test('renders a working state (timeline / empty / error), not the 404', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await goto(page);
    expect(new URL(page.url()).pathname).toBe('/admin/snapshots');
    const states = page.locator('[data-testid="snap-timeline"], [data-testid="snapshots-load-error"]');
    const emptyish = page.getByText(/no snapshots|snapshot/i);
    expect((await states.count()) + (await emptyish.count()), 'a snapshots state must render').toBeGreaterThan(0);
    const body = (await page.locator('body').innerText()).toLowerCase();
    expect(body.includes("admin page doesn't exist")).toBe(false);
  });

  test('the create-snapshot affordance is present (and opens/Escapes when enabled)', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await goto(page);
    const createBtn = page.locator('[data-testid="snapshot-create-button"]');
    await expect(createBtn, 'a create-snapshot control is present').toBeVisible({ timeout: 8000 });
    if (await createBtn.isEnabled()) {
      await createBtn.click();
      const nameInput = page.locator('[data-testid="snapshot-name-input"]');
      await expect(nameInput, 'create opens the name-input modal').toBeVisible({ timeout: 6000 });
      await page.keyboard.press('Escape');
      await expect(nameInput, 'Escape closes the create modal (no snapshot created)').toBeHidden({ timeout: 6000 });
    }
  });

  test('a snapshot-count counter renders', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await goto(page);
    await expect(page.locator('app-rolling-counter').first(), 'the snapshot count counter renders').toBeVisible({
      timeout: 8000,
    });
  });
});
