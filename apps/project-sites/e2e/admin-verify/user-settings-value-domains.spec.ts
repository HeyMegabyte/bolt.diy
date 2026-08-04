/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — User Settings VALUE-DOMAIN form
 * validation in a real browser (directive #3 / TDD Contract #10).
 *
 * Two forms, two interaction types:
 *  1. Display name (direct field) — `displayNameError()` (≤80 chars; empty = no
 *     error but Save gated on length>0; injection-shaped is accepted as free text —
 *     the BE parameterizes). Covers the empty-vs-invalid nuance a naive spec misses.
 *  2. API-key create MODAL — clicking the trigger opens the dialog (an interaction),
 *     and the name field's `nameError()` (≤40 chars) validates live.
 *
 * Both validators are CLIENT-SIDE Angular signals → load-independent (robust under
 * parallel prod throttling; 6s assertion timeout for zoneless CD propagation — see
 * [[admin-verify-e2e-authoring-gotchas]]). Real session (E2E_API_KEY) so /admin/user
 * mounts authed.
 *
 * @see {@link ../helpers/realdata.ts}
 * @see {@link ./settings-value-domains.spec.ts} — the sibling Settings→General matrix.
 */
import { test, expect } from '../fixtures.js';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';

/** Display-name value domain: free text ≤80, empty is not an ERROR but blocks Save. */
const NAME_CASES: Array<{ label: string; value: string; invalid: boolean; canSave: boolean }> = [
  { label: 'valid', value: 'Brian Zalewski', invalid: false, canSave: true },
  { label: 'valid — single char', value: 'A', invalid: false, canSave: true },
  { label: 'valid — unicode', value: '日本語 résumé 🎉', invalid: false, canSave: true },
  // XSS-markup defense: the validator rejects `[<>]` / `javascript:` / `on…=`.
  { label: 'invalid — script markup', value: '<script>alert(1)</script>', invalid: true, canSave: false },
  { label: 'invalid — javascript: URI', value: 'javascript:alert(1)', invalid: true, canSave: false },
  { label: 'invalid — event-handler injection', value: 'x onerror=alert(1)', invalid: true, canSave: false },
  // SQL-injection-shaped is ACCEPTED as free text (no markup chars; the BE parameterizes).
  { label: 'valid — SQL-injection-shaped (free text)', value: "Robert'); DROP TABLE users;--", invalid: false, canSave: true },
  { label: 'boundary — exactly 80', value: 'x'.repeat(80), invalid: false, canSave: true },
  { label: 'overlong — 81', value: 'y'.repeat(81), invalid: true, canSave: false },
  { label: 'empty — no error, but Save gated on length>0', value: '', invalid: false, canSave: false },
];

test.describe('Admin · User Settings — value-domain validation (P0-ADMIN, TDD #10)', () => {
  test('display-name validates live across the value-domain matrix (empty ≠ invalid, but blocks Save)', async ({
    page,
  }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await setupRealDataPage(page, { passthrough: /\/api\// });
    await page.goto('/admin/user', { waitUntil: 'domcontentloaded' });

    const input = page.locator('[data-testid="us-display-name-input"]');
    await input.waitFor({ state: 'visible', timeout: 15000 });
    const save = page.locator('[data-testid="us-display-name-save"]');

    for (const { label, value, invalid, canSave } of NAME_CASES) {
      await input.fill(value);
      await input.blur();
      if (invalid) {
        await expect(input, `name "${label}" must flag aria-invalid`).toHaveAttribute('aria-invalid', 'true', {
          timeout: 6000,
        });
      } else {
        await expect(input, `name "${label}" must NOT flag invalid`).not.toHaveAttribute('aria-invalid', 'true', {
          timeout: 6000,
        });
      }
      // Save gates on (length>0 AND no error) — the empty case is the key nuance:
      // not an error, but not saveable either.
      if (canSave) {
        await expect(save, `name "${label}" must ENABLE Save`).toBeEnabled({ timeout: 6000 });
      } else {
        await expect(save, `name "${label}" must DISABLE Save`).toBeDisabled({ timeout: 6000 });
      }
    }
  });

  test('API-key create modal opens on click + the name field validates ≤40 chars live', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await setupRealDataPage(page, { passthrough: /\/api\// });
    await page.goto('/admin/user', { waitUntil: 'domcontentloaded' });

    // Open the create-key modal via whichever trigger is present (empty-state CTA
    // when the org has no keys, else the header button).
    const trigger = page
      .locator('[data-testid="apikey-create-button"], [data-testid="apikey-empty-create"]')
      .first();
    await trigger.waitFor({ state: 'visible', timeout: 15000 });
    await trigger.click();

    // The modal opened → its name input is now visible (a real interaction result).
    const nameInput = page.locator('[data-testid="apikey-modal-name"]');
    await expect(nameInput, 'clicking the trigger must OPEN the create-key modal').toBeVisible({ timeout: 6000 });

    // Name value domain (worker + client cap = 40 chars).
    await nameInput.fill('CI deploy key');
    await nameInput.blur();
    await expect(nameInput, 'a valid ≤40-char name must NOT flag invalid').not.toHaveAttribute(
      'aria-invalid',
      'true',
      { timeout: 6000 },
    );

    // The name input enforces its ≤40 cap via `maxlength` — typing more truncates,
    // so the "too long" error is unreachable by design (a stronger client-side
    // defense than a post-hoc error). Assert the cap actually holds.
    await nameInput.fill('z'.repeat(45));
    const capped = await nameInput.inputValue();
    expect(capped.length, 'the name input must cap at 40 chars (maxlength)').toBeLessThanOrEqual(40);
    await expect(nameInput, 'a length-capped name stays valid (no error)').not.toHaveAttribute(
      'aria-invalid',
      'true',
      { timeout: 6000 },
    );

    // Esc dismisses the modal (keyboard interaction) — the name input goes away.
    await page.keyboard.press('Escape');
    await expect(nameInput, 'Escape must close the modal').toBeHidden({ timeout: 6000 });
  });
});
