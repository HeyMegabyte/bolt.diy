/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — User Settings (`/admin/user`) interactions
 * NOT already covered by user-settings-value-domains.spec (profile) or
 * user-sessions.spec (sessions): the theme buttons, the API-keys create modal, and
 * the account-delete confirmation dialog.
 *
 * Org-agnostic + safety-first: modals are opened + cancelled but NEVER submitted —
 * we never create a key or delete the account (see [[admin-verify-e2e-authoring-gotchas]] #5).
 * Enumerated read-only (directive #1).
 *
 * @see {@link ../helpers/realdata.ts}
 */
import { test, expect } from '../fixtures.js';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';

const goto = async (page: import('@playwright/test').Page) => {
  await setupRealDataPage(page, { passthrough: /\/api\// });
  await page.goto('/admin/user', { waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="us-profile-card"]').waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
};

test.describe('Admin · User Settings interactions (P0-ADMIN)', () => {
  test('the theme buttons set <html data-theme> + persist to localStorage', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await goto(page);

    const read = () =>
      page.evaluate(() => ({
        attr: document.documentElement.getAttribute('data-theme'),
        stored: localStorage.getItem('ps_theme'),
      }));

    await page.locator('[data-testid="theme-light"]').click();
    await expect.poll(async () => (await read()).attr, { timeout: 6000 }).toBe('light');
    expect((await read()).stored, 'light persists to localStorage').toBe('light');

    await page.locator('[data-testid="theme-dark"]').click();
    await expect.poll(async () => (await read()).attr, { timeout: 6000 }).toBe('dark');
    expect((await read()).stored, 'dark persists to localStorage').toBe('dark');
  });

  test('the API-keys create modal opens and cancels (no key created)', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await goto(page);

    // Either the header "New key" button or the empty-state "Create" — one exists.
    const createBtn = page.locator('[data-testid="apikey-create-button"], [data-testid="apikey-empty-create"]').first();
    await expect(createBtn, 'an API-key create affordance is present').toBeVisible({ timeout: 8000 });
    await createBtn.click();

    const nameField = page.locator('[data-testid="apikey-modal-name"]');
    await expect(nameField, 'the create-key modal opens').toBeVisible({ timeout: 6000 });
    await page.locator('[data-testid="apikey-modal-cancel"]').click();
    await expect(nameField, 'cancel closes the modal (no key created)').toBeHidden({ timeout: 6000 });
  });

  test('the delete-account dialog opens, confirm-gates on the exact phrase, and cancels', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await goto(page);

    await page.locator('[data-testid="delete-account-button"]').click();
    const confirmInput = page.locator('[data-testid="delete-account-confirm-input"]');
    await expect(confirmInput, 'the delete-account dialog opens').toBeVisible({ timeout: 6000 });

    // The final delete stays gated until the exact phrase is typed (a real safety gate).
    const confirmBtn = page.locator('[data-testid="delete-account-confirm"]');
    await expect(confirmBtn, 'delete is disabled before the phrase is typed').toBeDisabled();
    await confirmInput.fill('delete my account');
    await expect(page.locator('[data-testid="delete-confirm-ready"]'), 'the phrase-confirmed state shows').toBeVisible({
      timeout: 6000,
    });

    // Cancel — NEVER click the real delete.
    await page.getByRole('button', { name: /cancel|keep/i }).first().click();
    await expect(confirmInput, 'cancel closes the delete dialog without deleting').toBeHidden({ timeout: 6000 });
  });
});
