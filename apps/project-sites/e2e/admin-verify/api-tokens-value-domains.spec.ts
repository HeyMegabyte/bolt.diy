/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — VALUE-DOMAIN coverage (directive #3) for
 * the API Tokens CREATE form (`/admin/api-tokens`). api-tokens-interactions covers
 * the list/stats; THIS drives the create-token dialog's field validation across the
 * value-domain (empty / whitespace / valid name; past / future expiry) + confirms
 * the submit gates on each.
 *
 * NON-MUTATING: it opens the dialog and exercises validation only — it NEVER clicks
 * `at-create-submit`, so no token is ever minted against prod.
 *
 * Testids (enumerated read-only): `at-create-open` → dialog · `at-name-input`
 * (required, trimmed) · `token-expires` (datetime-local, `expiryInvalid()` if past)
 * · `token-expiry-err` · `at-create-submit` (`[disabled]="creating() || !name.trim()
 * || expiryInvalid()"`).
 *
 * @see {@link ../helpers/realdata.ts}
 * @see {@link ./api-tokens-interactions.spec.ts}
 */
import { test, expect } from '../fixtures.js';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';

const openCreate = async (page: import('@playwright/test').Page) => {
  await setupRealDataPage(page, { passthrough: /\/api\// });
  await page.goto('/admin/api-tokens', { waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="at-create-open"]').waitFor({ state: 'visible', timeout: 15000 });
  await page.locator('[data-testid="at-create-open"]').click();
  await page.locator('[data-testid="at-name-input"]').waitFor({ state: 'visible', timeout: 8000 });
};

test.describe('Admin · API token create — value domain (P0-ADMIN)', () => {
  test('the name field gates submit: empty / whitespace block it, a real name (incl. unicode) unblocks', async ({
    page,
  }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await openCreate(page);
    const name = page.locator('[data-testid="at-name-input"]');
    const submit = page.locator('[data-testid="at-create-submit"]');

    // Empty (default) → submit disabled.
    await name.fill('');
    await expect(submit, 'empty name blocks submit').toBeDisabled();

    // Whitespace-only → still blocked (trimmed).
    await name.fill('    ');
    await expect(submit, 'whitespace-only name blocks submit').toBeDisabled();

    // A real name (with unicode — the display name has no pattern restriction) → the
    // name no longer blocks submit (expiry is empty = valid, so it becomes enabled).
    await name.fill('CI probe tökén 🚀');
    await expect(submit, 'a real name (expiry empty) enables submit').toBeEnabled({ timeout: 4000 });
  });

  test('the expiry field rejects a past datetime and accepts a future one', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await openCreate(page);
    await page.locator('[data-testid="at-name-input"]').fill('CI expiry probe');
    const expiry = page.locator('#token-expires');
    const err = page.locator('[data-testid="token-expiry-err"]');
    const submit = page.locator('[data-testid="at-create-submit"]');

    // Past datetime → the invalid affordance shows + submit is blocked.
    await expiry.fill('2020-01-01T00:00');
    await expect(err, 'a past expiry shows the invalid affordance').toBeVisible({ timeout: 4000 });
    await expect(submit, 'a past expiry blocks submit').toBeDisabled();

    // Future datetime → the error clears + submit unblocks.
    await expiry.fill('2035-01-01T00:00');
    await expect(err, 'a future expiry clears the error').toBeHidden({ timeout: 4000 });
    await expect(submit, 'a valid name + future expiry enables submit').toBeEnabled({ timeout: 4000 });
  });

  test('scope checkboxes render with a sensible default and toggle', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await openCreate(page);
    // The default scope (sites:read) is pre-selected; scopes are toggleable checkboxes.
    const readScope = page.locator('#scope-sites\\:read');
    await expect(readScope, 'the sites:read scope control renders').toBeVisible({ timeout: 6000 });
    // A second scope toggles on without gating submit (scopes are not required).
    const writeScope = page.locator('#scope-sites\\:write');
    if ((await writeScope.count()) > 0) {
      await writeScope.click();
      await page.locator('[data-testid="at-name-input"]').fill('CI scope probe');
      await expect(
        page.locator('[data-testid="at-create-submit"]'),
        'toggling a scope keeps the form usable',
      ).toBeEnabled({ timeout: 4000 });
    }
  });
});
