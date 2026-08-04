/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — VALUE-DOMAIN coverage (TDD Contract #10)
 * for the Domains "Connect a custom domain" input, exercising every value class:
 * valid / invalid / empty / boundary / overlong / unicode / injection-shaped.
 *
 * The input (`custom-domain-input`) is validated CLIENT-SIDE by `isValidDomain()`
 * — stated full parity with the worker's `hostnameSchema` (min 3 / max 253 + RFC
 * format). It gates the "Add domain" submit (`[disabled]="!isValidDomain(...)"`) and
 * drives `aria-invalid` via `customDomainInvalid()` (= non-empty AND not valid). So
 * the client rejects bad input BEFORE any request → this test NEVER submits (zero
 * mutation, safe to throw injection/unicode at it) and asserts the gate purely from
 * the DOM (button disabled-state + aria-invalid) → load-independent + robust.
 *
 * Real session (E2E_API_KEY) so /admin/domains mounts authed.
 *
 * @see {@link ../helpers/realdata.ts}
 * @see {@link ./settings-value-domains.spec.ts} — the other value-domain matrix.
 */
import { test, expect } from '../fixtures.js';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';

/** Every value class per TDD #10 → whether isValidDomain() should accept it. */
const CASES: ReadonlyArray<{ label: string; value: string; valid: boolean }> = [
  { label: 'valid 3-part', value: 'www.example.com', valid: true },
  { label: 'valid 2-part', value: 'acme.io', valid: true },
  { label: 'valid hyphenated', value: 'my-shop.co.uk', valid: true },
  { label: 'invalid: no TLD dot', value: 'localhost', valid: false },
  { label: 'invalid: spaces', value: 'www example com', valid: false },
  { label: 'invalid: protocol prefix', value: 'http://x.com', valid: false },
  { label: 'invalid: trailing path', value: 'x.com/path', valid: false },
  { label: 'boundary: too short (<3)', value: 'ab', valid: false },
  { label: 'unicode/IDN (non-punycode)', value: 'münchen.de', valid: false },
  { label: 'injection-shaped', value: '<script>alert(1)</script>.com', valid: false },
  { label: 'sql-injection-shaped', value: "a'; DROP TABLE domains;--.com", valid: false },
] as const;

test.describe('Admin · Domains custom-domain value-domain matrix (P0-ADMIN)', () => {
  test('the client gate accepts valid domains and rejects every bad value class (no submit)', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await setupRealDataPage(page, { passthrough: /\/api\// });
    await page.goto('/admin/domains', { waitUntil: 'domcontentloaded' });

    const input = page.locator('[data-testid="custom-domain-input"]');
    await input.waitFor({ state: 'visible', timeout: 15000 });
    const addBtn = page.getByRole('button', { name: /add domain/i });

    // Boundary: the input hard-caps length at 253 (worker max) via maxlength.
    await expect(input, 'the input must cap length at the 253-char hostname max').toHaveAttribute('maxlength', '253');

    for (const { label, value, valid } of CASES) {
      await input.fill(value);
      if (valid) {
        await expect(addBtn, `${label} → submit enabled`).toBeEnabled({ timeout: 6000 });
        await expect(input, `${label} → not flagged invalid`).toHaveAttribute('aria-invalid', 'false');
      } else {
        await expect(addBtn, `${label} → submit disabled (client rejects)`).toBeDisabled({ timeout: 6000 });
        await expect(input, `${label} → aria-invalid set`).toHaveAttribute('aria-invalid', 'true');
        // The inline hint appears for a non-empty invalid value.
        await expect(page.locator('[data-testid="custom-domain-hint"]'), `${label} → inline hint shown`).toBeVisible({
          timeout: 6000,
        });
      }
    }
  });

  test('empty input is a neutral no-op — disabled submit, NOT flagged invalid', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await setupRealDataPage(page, { passthrough: /\/api\// });
    await page.goto('/admin/domains', { waitUntil: 'domcontentloaded' });

    const input = page.locator('[data-testid="custom-domain-input"]');
    await input.waitFor({ state: 'visible', timeout: 15000 });
    const addBtn = page.getByRole('button', { name: /add domain/i });

    // Type then clear → back to empty. Empty is "not yet valid", never "invalid".
    await input.fill('x.com');
    await input.fill('');
    await expect(addBtn, 'empty input keeps submit disabled').toBeDisabled();
    await expect(input, 'empty input is NOT flagged aria-invalid (neutral, not an error)').toHaveAttribute(
      'aria-invalid',
      'false',
    );
    await expect(
      page.locator('[data-testid="custom-domain-hint"]'),
      'no inline error hint for an empty field',
    ).toBeHidden();
  });
});
