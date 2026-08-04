/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — VALUE-DOMAIN coverage (directive #3) for
 * the create-Snapshot name field (`/admin/snapshots`). snapshots-interactions covers
 * the list; this drives the create-dialog name boundary + submit-gate.
 *
 * The create button is `[disabled]="!selectedSite()"` → seeds a site via
 * `selectFirstSite`. NON-MUTATING: opens the create dialog + exercises the name
 * boundary/gate only — it NEVER clicks `snapshot-create-submit`, so no snapshot is
 * created (which would trigger a build).
 *
 * Validator (enumerated read-only, snapshots.component:1461 `nameError`): empty →
 * null; `> 50` chars → error (but `maxlength="50"` enforces the boundary); a
 * case-insensitive DUPLICATE of an existing snapshot → error. `canCreate()` gates
 * submit on non-empty + no error.
 *
 * @see {@link ../helpers/site-context.ts}
 */
import { test, expect } from '../fixtures.js';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';
import { selectFirstSite } from '../helpers/site-context.js';

const openCreateDialog = async (page: import('@playwright/test').Page): Promise<boolean> => {
  await setupRealDataPage(page, { passthrough: /\/api\// });
  await page.goto('/admin/snapshots', { waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="snapshot-create-button"]').waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
  if (!(await selectFirstSite(page))) return false;
  const openBtn = page.locator('[data-testid="snapshot-create-button"]');
  if ((await openBtn.count()) === 0) return false;
  await openBtn.click();
  const name = page.locator('[data-testid="snapshot-name-input"]');
  await name.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
  return name.isVisible().catch(() => false);
};

test.describe('Admin · create-Snapshot name — value domain (P0-ADMIN)', () => {
  test('the name field enforces the 50-char cap (overlong is truncated)', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    test.skip(!(await openCreateDialog(page)), 'snapshot create dialog unreachable (no site)');
    const name = page.locator('[data-testid="snapshot-name-input"]');

    await name.fill('x'.repeat(120));
    expect((await name.inputValue()).length, 'name is capped at 50 chars').toBeLessThanOrEqual(50);
  });

  test('empty blocks submit; a valid unique name enables it (unicode accepted)', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    test.skip(!(await openCreateDialog(page)), 'snapshot create dialog unreachable (no site)');
    const name = page.locator('[data-testid="snapshot-name-input"]');
    const submit = page.locator('[data-testid="snapshot-create-submit"]');

    // Empty → submit blocked (canCreate false).
    await name.fill('');
    await expect(submit, 'an empty name blocks submit').toBeDisabled();

    // Whitespace-only → still blocked (trimmed).
    await name.fill('   ');
    await expect(submit, 'a whitespace-only name blocks submit').toBeDisabled();

    // A valid, unique name (incl. unicode — no pattern restriction) → submit enables.
    // NEVER clicked — asserting the gate only, so no snapshot/build is triggered.
    await name.fill('ci probe sn+shot ✓ 2035');
    await expect(submit, 'a valid unique name enables submit').toBeEnabled({ timeout: 4000 });
  });
});
