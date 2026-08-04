/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — Settings → General VALUE-DOMAIN form
 * validation in a real browser (directive #3 / TDD Contract #10: valid / invalid /
 * empty / boundary / overlong / unicode / injection-shaped).
 *
 * The brand-hex + contact-email validators (`hexInvalid` / `emailInvalid` in
 * settings.component.ts) are CLIENT-SIDE Angular signals, so driving the real
 * inputs + asserting `aria-invalid` + the gated Save button is LOAD-INDEPENDENT
 * (robust under parallel prod throttling — see [[admin-verify-e2e-authoring-gotchas]]).
 *   hexInvalid  = !HexColorSchema.safeParse(v).success  (`/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/`; empty = optional → valid)
 *   Save button = [disabled]="saving() || generalSettingsInvalid()"
 *
 * Real session (E2E_API_KEY) so /admin/settings mounts authed. This is the value
 * the Karma unit tests assert, now proven end-to-end in a real browser on prod.
 *
 * @see {@link ../helpers/realdata.ts}
 */
import { test, expect, type Locator } from '../fixtures.js';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';

/** The full value-domain matrix for a hex-color field (`#RGB` or `#RRGGBB`). */
const HEX_CASES: Array<{ label: string; value: string; invalid: boolean }> = [
  { label: 'valid 6-digit', value: '#112233', invalid: false },
  { label: 'valid 3-digit (boundary)', value: '#abc', invalid: false },
  { label: 'valid brand default', value: '#00E5FF', invalid: false },
  { label: 'invalid — missing hash', value: '112233', invalid: true },
  { label: 'invalid — 4 digits (boundary)', value: '#1234', invalid: true },
  { label: 'invalid — 5 digits (boundary)', value: '#12345', invalid: true },
  { label: 'invalid — non-hex letters', value: '#gghhii', invalid: true },
  { label: 'invalid — free text', value: 'not-a-hex', invalid: true },
  { label: 'invalid — overlong', value: '#0011223344556677', invalid: true },
  { label: 'invalid — injection-shaped', value: '<script>#000', invalid: true },
  { label: 'empty (optional → valid)', value: '', invalid: false },
];

const EMAIL_CASES: Array<{ label: string; value: string; invalid: boolean }> = [
  { label: 'valid', value: 'owner@example.com', invalid: false },
  { label: 'valid — plus-tag + subdomain', value: 'a.b+tag@mail.example.co', invalid: false },
  { label: 'invalid — no @', value: 'not-an-email', invalid: true },
  { label: 'invalid — no domain', value: 'x@', invalid: true },
  { label: 'invalid — spaces', value: 'a b@example.com', invalid: true },
  { label: 'invalid — injection-shaped', value: '"><img src=x>@x.com', invalid: true },
  { label: 'empty (optional → valid)', value: '', invalid: false },
];

async function gotoSettings(page: import('@playwright/test').Page): Promise<Locator> {
  await setupRealDataPage(page, { passthrough: /\/api\// });
  await page.goto('/admin/settings', { waitUntil: 'domcontentloaded' });
  const hex = page.locator('[aria-label="Brand primary color hex value"]');
  await hex.waitFor({ state: 'visible', timeout: 15000 });
  return hex;
}

test.describe('Admin · Settings General — value-domain validation (P0-ADMIN, TDD #10)', () => {
  test('brand-hex validates live across the full value-domain matrix', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    const hex = await gotoSettings(page);

    for (const { label, value, invalid } of HEX_CASES) {
      await hex.fill(value);
      await hex.blur();
      if (invalid) {
        await expect(hex, `hex "${label}" (${value}) must flag aria-invalid`).toHaveAttribute(
          'aria-invalid',
          'true',
          { timeout: 6000 },
        );
      } else {
        await expect(hex, `hex "${label}" (${value}) must NOT flag invalid`).not.toHaveAttribute(
          'aria-invalid',
          'true',
          { timeout: 6000 },
        );
      }
    }
  });

  test('contact-email validates live across the value-domain matrix', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await gotoSettings(page);
    const email = page.getByPlaceholder('hello@yourbiz.com').first();
    await email.waitFor({ state: 'visible', timeout: 15000 });

    for (const { label, value, invalid } of EMAIL_CASES) {
      await email.fill(value);
      await email.blur();
      if (invalid) {
        await expect(email, `email "${label}" (${value}) must flag aria-invalid`).toHaveAttribute(
          'aria-invalid',
          'true',
          { timeout: 6000 },
        );
      } else {
        await expect(email, `email "${label}" (${value}) must NOT flag invalid`).not.toHaveAttribute(
          'aria-invalid',
          'true',
          { timeout: 6000 },
        );
      }
    }
  });

  test('Save button gates on validity (invalid input disables Save, valid re-enables)', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    const hex = await gotoSettings(page);
    const save = page.getByRole('button', { name: /Save general settings/i });

    // Start from a known-valid hex so Save reflects only the change under test.
    await hex.fill('#00E5FF');
    await hex.blur();

    // Invalid hex → Save disabled (the value-domain gate blocks a bad save).
    await hex.fill('not-a-hex');
    await hex.blur();
    await expect(save, 'invalid hex must DISABLE Save').toBeDisabled({ timeout: 6000 });

    // Back to valid → Save re-enables (assuming the emails are valid/empty).
    await hex.fill('#123abc');
    await hex.blur();
    await expect(save, 'valid hex must RE-ENABLE Save').toBeEnabled({ timeout: 6000 });
  });
});
