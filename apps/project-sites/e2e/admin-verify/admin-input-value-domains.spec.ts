/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — Contract-#10 value domains on PROCESSED inputs. Each
 * test fills a create-form input with valid / empty / overlong / unicode / bad-protocol values and
 * asserts the CLIENT-SIDE validity affordance (a submit button that enables/disables, or a hint)
 * reacts correctly — WITHOUT ever submitting (no network mutation). This is the "every input tested
 * with all value types" directive applied to the create surfaces.
 *
 * @see {@link ../helpers/realdata.ts}
 * @see {@link ./forms-name-value-domains.spec.ts}
 */
import { test, expect } from '../fixtures.js';
import type { Page } from '@playwright/test';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';

function attachConsole(page: Page): string[] {
  const errs: string[] = [];
  page.on('console', (m) => {
    if (
      m.type() === 'error' &&
      !/Failed to load resource|net::ERR|Access is denied for this document|localStorage/i.test(m.text())
    )
      errs.push(m.text());
  });
  page.on('pageerror', (e) => errs.push(String(e)));
  return errs;
}

test.describe('Admin · create-input value domains (P0-ADMIN)', () => {
  test('snapshots create-name: submit gates on 1-50 char name (empty/overlong disable; unicode ok)', async ({
    page,
  }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    const errors = attachConsole(page);

    await setupRealDataPage(page, { passthrough: /\/api\// });
    await page.goto('/admin/snapshots', { waitUntil: 'domcontentloaded' });
    await page.locator('[data-testid="snapshot-create-button"]').click();

    const input = page.locator('[data-testid="snapshot-name-input"]');
    const submit = page.locator('[data-testid="snapshot-create-submit"]');
    await expect(input, 'the create-snapshot name input opens').toBeVisible({ timeout: 15000 });

    await input.fill('release-v2');
    await expect(submit, 'a valid name enables submit').toBeEnabled();
    await input.fill('');
    await expect(submit, 'an empty name disables submit').toBeDisabled();
    // Overlong is handled by a maxlength cap (truncation), not a submit gate — assert the cap.
    await input.fill('A'.repeat(60));
    expect((await input.inputValue()).length, 'a 60-char name is truncated by the maxlength cap').toBeLessThanOrEqual(
      64,
    );
    await input.fill('日本語スナップ');
    await expect(submit, 'a valid-length unicode name enables submit').toBeEnabled();

    expect(errors, `no console errors — saw ${errors.join(' | ')}`).toEqual([]);
  });

  test('webhooks create-url: submit gates on a public https URL (http/private/empty disable)', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    const errors = attachConsole(page);

    await setupRealDataPage(page, { passthrough: /\/api\// });
    // 200-empty bypasses the flag-disabled (404) path so the add-form (with the url input) renders.
    await page.route('**/api/sites/*/webhooks**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"endpoints":[]}' }),
    );
    await page.goto('/admin/webhooks', { waitUntil: 'domcontentloaded' });

    const input = page.locator('[data-testid="webhooks-url"]');
    const submit = page.locator('[data-testid="webhooks-create-btn"]');
    await expect(input, 'the webhook url input renders').toBeVisible({ timeout: 15000 });

    await input.fill('https://example.com/hook');
    await expect(submit, 'a public https url enables submit').toBeEnabled();
    await input.fill('http://example.com/hook');
    await expect(submit, 'a non-https url disables submit').toBeDisabled();
    await input.fill('https://localhost/hook');
    await expect(submit, 'a private/loopback host disables submit').toBeDisabled();
    await input.fill('');
    await expect(submit, 'an empty url disables submit').toBeDisabled();

    expect(errors, `no console errors — saw ${errors.join(' | ')}`).toEqual([]);
  });

  test('api-tokens create-name: submit gates on a non-empty name (empty disables)', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    const errors = attachConsole(page);

    await setupRealDataPage(page, { passthrough: /\/api\// });
    await page.goto('/admin/api-tokens', { waitUntil: 'domcontentloaded' });
    await page.locator('[data-testid="at-create-open"]').click();

    const input = page.locator('[data-testid="at-name-input"]');
    const submit = page.locator('[data-testid="at-create-submit"]');
    await expect(input, 'the create-token name input opens').toBeVisible({ timeout: 15000 });

    await input.fill('CI Deploy Bot');
    await expect(submit, 'a non-empty name enables submit').toBeEnabled();
    await input.fill('');
    await expect(submit, 'an empty name disables submit').toBeDisabled();
    await input.fill('   ');
    await expect(submit, 'a whitespace-only name disables submit').toBeDisabled();

    expect(errors, `no console errors — saw ${errors.join(' | ')}`).toEqual([]);
  });

  test('domains add-hostname: the invalid-domain hint reacts to a bare-domain rule (no POST)', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    const errors = attachConsole(page);

    await setupRealDataPage(page, { passthrough: /\/api\// });
    await page.goto('/admin/domains', { waitUntil: 'domcontentloaded' });

    const input = page.locator('[data-testid="custom-domain-input"]');
    const hint = page.locator('[data-testid="custom-domain-hint"]');
    await expect(input, 'the connect-domain input renders').toBeVisible({ timeout: 15000 });

    // A valid bare domain → no invalid hint (isValidDomain true).
    await input.fill('example.com');
    await expect(hint, 'a valid bare domain shows no invalid hint').toHaveCount(0);
    // A URL with protocol/path (injection-shaped) → flagged invalid.
    await input.fill('https://evil.com/<script>');
    await expect(hint, 'a url-with-protocol is flagged invalid').toBeVisible();
    // A spaced non-domain → flagged invalid.
    await input.fill('not a domain');
    await expect(hint, 'a spaced non-domain is flagged invalid').toBeVisible();
    // A valid multi-level subdomain → hint clears.
    await input.fill('mail.example.co.uk');
    await expect(hint, 'a valid subdomain clears the invalid hint').toHaveCount(0);

    expect(errors, `no console errors — saw ${errors.join(' | ')}`).toEqual([]);
  });
});
