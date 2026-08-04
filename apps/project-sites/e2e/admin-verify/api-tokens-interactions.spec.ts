/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — API Tokens (`/admin/api-tokens`): populated
 * stats + honest-empty + the create-token modal with a VALUE-DOMAIN gate (directive #3).
 * Org-agnostic (e2e-org has 0 tokens → empty state). The modal is opened + cancelled but
 * NEVER submitted (never mints a real key). Enumerated read-only (directive #1).
 *
 * @see {@link ../helpers/realdata.ts}
 */
import { test, expect } from '../fixtures.js';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';

const goto = async (page: import('@playwright/test').Page) => {
  await setupRealDataPage(page, { passthrough: /\/api\// });
  await page.goto('/admin/api-tokens', { waitUntil: 'domcontentloaded' });
  await page.getByText(/api tokens/i).first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
};

const openCreate = (page: import('@playwright/test').Page) =>
  page.locator('[data-testid="at-create-open"], [data-testid="apikey-create-button"], [data-testid="apikey-empty-create"]').first();

test.describe('Admin · API Tokens interactions (P0-ADMIN)', () => {
  test('renders populated stats + honest-empty state, not 404', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await goto(page);
    expect(new URL(page.url()).pathname).toBe('/admin/api-tokens');
    await expect(page.locator('app-rolling-counter').first(), 'the token stat counters render').toBeVisible({
      timeout: 8000,
    });
    await expect(page.getByText(/no api tokens yet|active tokens|scopes/i).first(), 'a token state renders').toBeVisible({
      timeout: 8000,
    });
    const body = (await page.locator('body').innerText()).toLowerCase();
    expect(body.includes("admin page doesn't exist")).toBe(false);
  });

  test('the create-token modal opens and cancels (no key minted)', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await goto(page);
    await expect(openCreate(page), 'a create-token affordance is present').toBeVisible({ timeout: 8000 });
    await openCreate(page).click();
    const name = page.locator('[data-testid="at-name-input"], [data-testid="apikey-modal-name"]').first();
    await expect(name, 'the create modal opens').toBeVisible({ timeout: 6000 });
    await page.getByRole('button', { name: /cancel/i }).first().click();
    await expect(name, 'cancel closes the modal (no key created)').toBeHidden({ timeout: 6000 });
  });

  test('value-domain: the create submit gates on a non-empty token name (directive #3)', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await goto(page);
    await openCreate(page).click();
    const name = page.locator('[data-testid="at-name-input"], [data-testid="apikey-modal-name"]').first();
    const submit = page.locator('[data-testid="at-create-submit"], [data-testid="apikey-modal-submit"]').first();
    await expect(name, 'the name input renders').toBeVisible({ timeout: 6000 });

    // Empty / whitespace name → submit disabled (client rejects, never mints a key).
    await name.fill('   ');
    await expect(submit, 'a blank name keeps create disabled').toBeDisabled();
    // A real name → submit enabled (but we never click it).
    await name.fill('ci-e2e-probe-token');
    await expect(submit, 'a valid name enables create').toBeEnabled({ timeout: 6000 });
  });
});
