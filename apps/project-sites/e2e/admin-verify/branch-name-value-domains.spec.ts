/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — VALUE-DOMAIN coverage (directive #3) for
 * the create-BRANCH name field (`/admin/sites/:id/branches`).
 *
 * The siteId comes from the ROUTE param (site-branches.component:283), so resolving
 * the org's first site id into the URL renders the form WITHOUT a globally-selected
 * site. NON-MUTATING: drives the `+ New branch` toggle + name validation only — it
 * NEVER clicks `branch-create-submit`, so no branch is created.
 *
 * Validator (enumerated read-only): `BranchNameSchema` = `/^[a-z0-9](?:[a-z0-9-]{0,61}
 * [a-z0-9])?$/` (DNS label). `branchNameInvalid()` is LIVE (gates as you type):
 * true when non-empty AND not schema-valid. Error `#branch-name-hint`
 * (`@if (branchNameInvalid())`), input `[attr.aria-invalid]="branchNameInvalid() ||
 * null"`, submit `[disabled]="creating() || !name.trim() || branchNameInvalid()"`.
 *
 * @see {@link ../helpers/realdata.ts}
 * @see {@link ../helpers/site-context.ts}
 */
import { test, expect } from '../fixtures.js';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';
import { resolveFirstSiteId } from '../helpers/site-context.js';

const openBranchForm = async (page: import('@playwright/test').Page): Promise<boolean> => {
  const token = process.env.E2E_API_KEY!;
  await setupRealDataPage(page, { passthrough: /\/api\// });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const siteId = await resolveFirstSiteId(page, token);
  if (!siteId) return false;
  await page.goto(`/admin/sites/${siteId}/branches`, { waitUntil: 'domcontentloaded' });
  const toggle = page.locator('[data-testid="branch-new-toggle"]');
  await toggle.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
  if ((await toggle.count()) === 0) return false;
  await toggle.click();
  const input = page.locator('[data-testid="branch-name-input"]');
  await input.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
  return input.isVisible().catch(() => false);
};

test.describe('Admin · create-branch name — value domain (P0-ADMIN)', () => {
  test('non-DNS-label names (upper / hyphen-edge / underscore / space / injection / unicode) are rejected live', async ({
    page,
  }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    test.skip(!(await openBranchForm(page)), 'org has no site / branch form unreachable');
    const input = page.locator('[data-testid="branch-name-input"]');
    const hint = page.locator('#branch-name-hint');
    const submit = page.locator('[data-testid="branch-create-submit"]');

    for (const bad of ['MyBranch', '-leading', 'trailing-', 'a_b', 'a b', 'a;rm', 'café', 'a/b']) {
      await input.fill(bad);
      await expect(hint, `"${bad}" shows the DNS-label hint`).toBeVisible({ timeout: 4000 });
      await expect(input, `"${bad}" flips aria-invalid`).toHaveAttribute('aria-invalid', 'true');
      await expect(submit, `"${bad}" blocks submit`).toBeDisabled();
    }
  });

  test('a valid DNS-label name clears the error and enables submit; empty blocks it', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    test.skip(!(await openBranchForm(page)), 'org has no site / branch form unreachable');
    const input = page.locator('[data-testid="branch-name-input"]');
    const hint = page.locator('#branch-name-hint');
    const submit = page.locator('[data-testid="branch-create-submit"]');

    // Empty → no hint (branchNameInvalid false for ''), but submit blocked (!name.trim()).
    await input.fill('');
    await expect(submit, 'an empty name blocks submit').toBeDisabled();

    // A valid lowercase DNS label → hint clears, aria-invalid removed, submit enables.
    await input.fill('homepage-redesign-2');
    await expect(hint, 'a valid name hides the hint').toBeHidden({ timeout: 4000 });
    await expect(submit, 'a valid name enables submit').toBeEnabled({ timeout: 4000 });
  });
});
