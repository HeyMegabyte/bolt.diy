/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — VALUE-DOMAIN coverage (directive #3) for
 * the AI Endpoints create-SLUG field (`/admin/ai-endpoints` → "+ manual" create panel).
 * ai-endpoints-interactions covers the list/filter; this drives the slug validation.
 *
 * The section is `selectedSite()`-scoped → seeds a site via `selectFirstSite` first.
 * NON-MUTATING: drives the create panel + slug validation only — NEVER clicks
 * `ai-endpoint-create-submit`, so no endpoint is created/deployed.
 *
 * Validator (enumerated read-only, ai-endpoints/types.ts:136 `validateSlug`):
 * 2-64 chars AND `/^[a-z0-9]+(?:-[a-z0-9]+)*$/` (lowercase, digits, single-dash
 * separated). `slugLiveInvalid()` is LIVE. Error `[data-testid="ai-endpoint-create-slug-err"]`
 * (`@if (slugLiveInvalid(...))`), input aria-invalid on the same predicate.
 *
 * @see {@link ../helpers/site-context.ts}
 */
import { test, expect } from '../fixtures.js';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';
import { selectFirstSite } from '../helpers/site-context.js';

const openCreatePanel = async (page: import('@playwright/test').Page): Promise<boolean> => {
  await setupRealDataPage(page, { passthrough: /\/api\// });
  await page.goto('/admin/ai-endpoints', { waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="ai-endpoints-page"]').waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
  if (!(await selectFirstSite(page))) return false;
  const manual = page.locator('[data-testid="ai-endpoint-create-manual"]').first();
  await manual.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
  if ((await manual.count()) === 0) return false;
  await manual.click();
  const slug = page.locator('[data-testid="ai-endpoint-create-slug"]');
  await slug.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
  return slug.isVisible().catch(() => false);
};

test.describe('Admin · AI endpoint create-slug — value domain (P0-ADMIN)', () => {
  test('non-slug values (upper / underscore / space / short / hyphen-edge / injection / unicode) are rejected live', async ({
    page,
  }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    test.skip(!(await openCreatePanel(page)), 'ai-endpoints create panel unreachable (no site)');
    const slug = page.locator('[data-testid="ai-endpoint-create-slug"]');
    const err = page.locator('[data-testid="ai-endpoint-create-slug-err"]');

    // NOTE: validateSlug lowercases first (types.ts:137), so UPPERCASE is normalized —
    // not invalid. These are genuinely-invalid shapes (underscore/space/too-short/
    // hyphen-edge/double-hyphen/injection/unicode/slash).
    for (const bad of ['a_b', 'a b', 'a', 'a--b', '-lead', 'trail-', 'a;rm', 'café', 'a/b']) {
      await slug.fill('');
      await slug.pressSequentially(bad, { delay: 15 });
      await expect(err, `slug "${bad}" shows the validation error`).toBeVisible({ timeout: 4000 });
      await expect(slug, `slug "${bad}" flips aria-invalid`).toHaveAttribute('aria-invalid', 'true');
    }
  });

  test('a valid slug clears the error; empty shows none', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    test.skip(!(await openCreatePanel(page)), 'ai-endpoints create panel unreachable (no site)');
    const slug = page.locator('[data-testid="ai-endpoint-create-slug"]');
    const err = page.locator('[data-testid="ai-endpoint-create-slug-err"]');

    // Empty → no live error (slugLiveInvalid false for '').
    await slug.fill('');
    await expect(err, 'an empty slug shows no live error').toBeHidden({ timeout: 4000 });

    // A valid lowercase-dash slug → the error clears + aria-invalid is removed.
    await slug.fill('');
    await slug.pressSequentially('ci-probe-endpoint-2', { delay: 12 });
    await expect(err, 'a valid slug clears the error').toBeHidden({ timeout: 4000 });
    await expect(slug, 'a valid slug removes aria-invalid').not.toHaveAttribute('aria-invalid', 'true');

    // UPPERCASE is NORMALIZED (lowercased), not rejected — no error shows.
    await slug.fill('');
    await slug.pressSequentially('MyEndpoint', { delay: 12 });
    await expect(err, 'uppercase is normalized (not an error)').toBeHidden({ timeout: 4000 });
  });
});
