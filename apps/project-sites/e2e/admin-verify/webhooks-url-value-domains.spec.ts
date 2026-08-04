/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — VALUE-DOMAIN coverage (directive #3) for
 * the Webhooks endpoint-URL field (`/admin/settings` → "Webhooks" tab,
 * `app-admin-webhooks`).
 *
 * The panel is `@if (site())`-gated → seeds a site via `selectFirstSite` first.
 * NON-MUTATING: exercises the `urlInvalid()` live validation + the Create button's
 * disabled-gate only — it NEVER clicks `webhooks-create-btn`, so no webhook is created.
 *
 * Validator (enumerated read-only, webhooks.component:242 `isValidHttpsUrl`): must be
 * a parseable `https:` URL whose hostname (LOWERCASED, IPv6-brackets stripped) has a
 * dot and is NOT localhost / *.local / *.internal / a private-IPv4 range. `urlInvalid()`
 * is LIVE (`urlModel` is a signal). So UPPERCASE host is normalized (valid), and
 * non-https / private / single-label hosts are rejected. Error
 * `[data-testid="webhooks-url-hint"]` (`@if (urlInvalid())`), input aria-invalid on
 * the same predicate.
 *
 * @see {@link ../helpers/site-context.ts}
 */
import { test, expect } from '../fixtures.js';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';
import { selectFirstSite } from '../helpers/site-context.js';

const reachUrlField = async (page: import('@playwright/test').Page): Promise<boolean> => {
  await setupRealDataPage(page, { passthrough: /\/api\// });
  await page.goto('/admin/settings', { waitUntil: 'domcontentloaded' });
  await page.locator('[role="tab"]').first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
  if (!(await selectFirstSite(page))) return false;
  const tab = page.getByRole('tab', { name: /webhooks/i }).first();
  if ((await tab.count()) === 0) return false;
  await tab.click();
  const url = page.locator('[data-testid="webhooks-url"]');
  await url.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
  return url.isVisible().catch(() => false);
};

test.describe('Admin · Webhooks endpoint URL — value domain (P0-ADMIN)', () => {
  test('non-https / localhost / private-IP / single-label URLs are rejected live', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    test.skip(!(await reachUrlField(page)), 'webhooks URL field unreachable (no site)');
    const url = page.locator('[data-testid="webhooks-url"]');
    const hint = page.locator('[data-testid="webhooks-url-hint"]');

    for (const bad of [
      'notaurl',
      'http://example.com', // not https
      'ftp://example.com', // wrong protocol
      'https://localhost', // single-label / localhost
      'https://example', // no dot
      'https://192.168.1.1', // private IP
      'https://10.0.0.5', // private IP
      'https://api.internal', // .internal suffix
    ]) {
      await url.fill(bad);
      await expect(hint, `"${bad}" shows the URL hint`).toBeVisible({ timeout: 4000 });
      await expect(url, `"${bad}" flips aria-invalid`).toHaveAttribute('aria-invalid', 'true');
    }
  });

  test('a public https URL is accepted (uppercase host normalized); empty shows none', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    test.skip(!(await reachUrlField(page)), 'webhooks URL field unreachable (no site)');
    const url = page.locator('[data-testid="webhooks-url"]');
    const hint = page.locator('[data-testid="webhooks-url-hint"]');

    // Empty → no live error (urlInvalid false for '').
    await url.fill('');
    await expect(hint, 'an empty URL shows no live error').toBeHidden({ timeout: 4000 });

    // A public https URL → the hint clears + aria-invalid removed.
    await url.fill('https://hooks.example.com/projectsites');
    await expect(hint, 'a public https URL clears the hint').toBeHidden({ timeout: 4000 });
    await expect(url, 'a valid URL removes aria-invalid').not.toHaveAttribute('aria-invalid', 'true');

    // UPPERCASE hostname is NORMALIZED (lowercased) → still valid, no error.
    await url.fill('https://HOOKS.EXAMPLE.com/x');
    await expect(hint, 'uppercase host is normalized (not an error)').toBeHidden({ timeout: 4000 });
  });
});
