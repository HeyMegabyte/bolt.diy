/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — Feature Flags SENTINEL PROTECTION, a
 * real safety feature: `core_*` flags are load-bearing platform sentinels (auth,
 * admin, site-create) that must NEVER be disable-able or killswitch-able from the
 * admin UI — one fat-finger there would dark the whole platform.
 *
 * Contract (feature-flags.component.ts): `isSentinel(f) = f.key.startsWith('core_')`.
 * For a sentinel card the primary toggle is `[disabled]` + reads "Always on", and
 * the Killswitch button is `[disabled]` (the `toggle()`/`killswitch()` methods also
 * early-return — defence in depth). A non-sentinel card keeps LIVE controls
 * ("Enable/Disable globally", enabled). This is client-side state rendered from the
 * loaded flag registry → populated + load-independent → robust (see
 * [[admin-verify-e2e-authoring-gotchas]] #5, [[feature-flags-sentinel-protection]]).
 *
 * Real session (E2E_API_KEY) so /admin/feature-flags mounts authed + populates.
 *
 * @see {@link ../helpers/realdata.ts}
 * @see {@link ./feature-flags-search-filter.spec.ts}
 * @see {@link ./copy-to-clipboard.spec.ts}
 */
import { test, expect } from '../fixtures.js';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';

/** A flag card whose key button (aria-label "Copy flag key <key>") starts with core_. */
const CORE_KEY_BTN = '.ff-key-btn[aria-label^="Copy flag key core_"]';

test.describe('Admin · feature-flags sentinel protection (P0-ADMIN)', () => {
  test('the section populates real flags AND core_* sentinels cannot be disabled/killswitched', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await setupRealDataPage(page, { passthrough: /\/api\// });
    await page.goto('/admin/feature-flags', { waitUntil: 'domcontentloaded' });

    // Populated: the real flag registry renders as cards.
    const cards = page.locator('.ff-card');
    await cards.first().waitFor({ state: 'visible', timeout: 15000 });
    const total = await cards.count();
    expect(total, 'the flag registry must populate with real flags').toBeGreaterThan(0);

    // At least one core_* sentinel exists in the registry.
    const sentinelCard = page.locator('.ff-card').filter({ has: page.locator(CORE_KEY_BTN) }).first();
    await expect(sentinelCard, 'the registry must contain at least one core_* sentinel flag').toBeVisible({
      timeout: 6000,
    });

    // Its primary control is the protected "Always on" — disabled, cannot disable.
    const sentinelToggle = sentinelCard.locator('.ff-btn-primary');
    await expect(sentinelToggle, 'a core_* sentinel toggle must read "Always on"').toHaveText(/always on/i);
    await expect(sentinelToggle, 'a core_* sentinel must NOT be disable-able').toBeDisabled();

    // Its Killswitch button (rendered because a sentinel is never already killed) is disabled too.
    const sentinelKill = sentinelCard.locator('.ff-btn-danger');
    await expect(sentinelKill, 'a core_* sentinel must NOT be killswitch-able').toBeDisabled();
  });

  test('a non-sentinel flag keeps LIVE toggle controls (Enable/Disable globally)', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await setupRealDataPage(page, { passthrough: /\/api\// });
    await page.goto('/admin/feature-flags', { waitUntil: 'domcontentloaded' });

    await page.locator('.ff-card').first().waitFor({ state: 'visible', timeout: 15000 });
    // Let the full list settle before picking the first non-sentinel — a mid-load count
    // under parallel prod load made this flaky (gotcha 5).
    await expect.poll(() => page.locator('.ff-card').count(), { timeout: 8000 }).toBeGreaterThan(5);

    // First card that is NOT a core_* sentinel.
    const regularCard = page.locator('.ff-card').filter({ hasNot: page.locator(CORE_KEY_BTN) }).first();
    await expect(regularCard, 'the registry must contain non-sentinel flags').toBeVisible({ timeout: 6000 });

    // Its toggle is a live control, not the protected "Always on".
    const toggle = regularCard.locator('.ff-btn-primary');
    await expect(toggle, 'a regular flag toggle must offer Enable/Disable').toHaveText(/enable|disable/i);
    await expect(toggle, 'a regular flag toggle must be actionable (not the disabled sentinel)').toBeEnabled();
  });
});
