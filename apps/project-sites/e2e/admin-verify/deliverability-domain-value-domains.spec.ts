/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — VALUE-DOMAIN coverage (directive #3) for
 * the Email Deliverability sending-domain field (`/admin/deliverability`).
 * deliverability-populated covers the populated flow; this drives the domain
 * validation across the value-domain.
 *
 * The panel is `@if (site())`-gated → seeds a site via `selectFirstSite` first.
 * NON-MUTATING: exercises the `domainInvalid()` live validation + the Check button's
 * disabled-gate only — it NEVER clicks `deliverability-check-btn` (which would fire a
 * DNS lookup), so nothing is submitted.
 *
 * Validator (enumerated read-only, deliverability.component:245): `domainInvalid()` =
 * non-empty AND `!isValidDomain(d)` — a bare domain only (no `https://`, no path, no
 * spaces). Error `[data-testid="deliverability-domain-hint"]` (`@if (domainInvalid())`),
 * input aria-invalid on the same predicate; check `[disabled]="loading() ||
 * domainInvalid() || flagDisabled()"`.
 *
 * @see {@link ../helpers/site-context.ts}
 * @see {@link ./deliverability-populated.spec.ts}
 */
import { test, expect } from '../fixtures.js';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';
import { selectFirstSite } from '../helpers/site-context.js';

const reachDomainField = async (page: import('@playwright/test').Page): Promise<boolean> => {
  await setupRealDataPage(page, { passthrough: /\/api\// });
  await page.goto('/admin/deliverability', { waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="deliv-heading"]').waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
  if (!(await selectFirstSite(page))) return false;
  const domain = page.locator('[data-testid="deliverability-domain"]');
  await domain.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
  return domain.isVisible().catch(() => false);
};

test.describe('Admin · Email deliverability domain — value domain (P0-ADMIN)', () => {
  test('protocol / path / space / bare-word domains are rejected live', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    test.skip(!(await reachDomainField(page)), 'deliverability domain field unreachable (no site)');
    const domain = page.locator('[data-testid="deliverability-domain"]');
    const hint = page.locator('[data-testid="deliverability-domain-hint"]');
    const check = page.locator('[data-testid="deliverability-check-btn"]');

    for (const bad of ['https://example.com', 'example.com/path', 'ex ample.com', 'notadomain', 'a;b.com']) {
      await domain.fill(bad);
      await expect(hint, `"${bad}" shows the bare-domain hint`).toBeVisible({ timeout: 4000 });
      await expect(domain, `"${bad}" flips aria-invalid`).toHaveAttribute('aria-invalid', 'true');
      await expect(check, `"${bad}" keeps Check disabled`).toBeDisabled();
    }
  });

  test('a bare valid domain clears the error; empty shows none', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    test.skip(!(await reachDomainField(page)), 'deliverability domain field unreachable (no site)');
    const domain = page.locator('[data-testid="deliverability-domain"]');
    const hint = page.locator('[data-testid="deliverability-domain-hint"]');

    // Empty → no live error (domainInvalid false for '').
    await domain.fill('');
    await expect(hint, 'an empty domain shows no live error').toBeHidden({ timeout: 4000 });

    // A bare valid domain → the hint clears + aria-invalid is removed.
    await domain.fill('mail.example.com');
    await expect(hint, 'a valid bare domain clears the hint').toBeHidden({ timeout: 4000 });
    await expect(domain, 'a valid domain removes aria-invalid').not.toHaveAttribute('aria-invalid', 'true');
  });
});
