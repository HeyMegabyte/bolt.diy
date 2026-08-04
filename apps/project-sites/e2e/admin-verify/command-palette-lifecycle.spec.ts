/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — the global Command Palette (⌘/Ctrl+K),
 * a shell-level, org-data-INDEPENDENT surface EVERY admin route inherits: it opens,
 * moves focus into its input, filters its action registry live as you type, runs the
 * inline calculator, and closes on Escape. Keyboard-operable (WCAG 2.1.1). The dev
 * suite gates ⌘K-focus (frontend `e2e/cmdk-focus.spec.ts`); this is the prod
 * real-browser LIFECYCLE proof (open → focus → filter → calc → close).
 *
 * NON-MUTATING: only opens the palette + types into its filter + Escape — NEVER
 * presses Enter on a row (that would navigate/execute). The filter + calculator are
 * pure client-side `computed()` reads. The palette input is `@if(open())`-gated, so
 * `palette-input` visible ⟺ the palette is open.
 *
 * @see {@link ./admin-modal-lifecycle.spec.ts}
 */
import { test, expect } from '../fixtures.js';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';

const openAdmin = async (page: import('@playwright/test').Page) => {
  await setupRealDataPage(page, { passthrough: /\/api\// });
  await page.goto('/admin', { waitUntil: 'domcontentloaded' });
  // The palette registers its document keydown listener on component init. A stable
  // admin-shell testid becoming visible means AdminComponent (and its palette child)
  // has fully mounted — main-text-length resolves too early (before listeners attach).
  await page.locator('[data-testid="user-avatar-btn"]').waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(400); // settle: palette + global keydown listeners attached
};

const paletteInput = (page: import('@playwright/test').Page) => page.locator('[data-testid="palette-input"]');

test.describe('Admin · command palette lifecycle (⌘/Ctrl+K) (P0-ADMIN)', () => {
  test('Ctrl+K opens the palette, focuses its input, and Escape closes it', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for the authed admin shell');
    await openAdmin(page);

    await page.keyboard.press('Control+k');
    await expect(paletteInput(page), 'Ctrl+K opens the command palette').toBeVisible({ timeout: 6000 });
    // Focus lands in the palette input (openIt() focuses on the next animation frame).
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.getAttribute('data-testid')), { timeout: 4000 })
      .toBe('palette-input');

    await page.keyboard.press('Escape');
    await expect(paletteInput(page), 'Escape closes the palette').toBeHidden({ timeout: 6000 });
  });

  test('typing filters the action registry live (non-mutating — never Enter)', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for the authed admin shell');
    await openAdmin(page);

    await page.keyboard.press('Control+k');
    const input = paletteInput(page);
    await expect(input).toBeVisible({ timeout: 6000 });

    await input.pressSequentially('settings', { delay: 25 });
    await expect(input, 'the palette input holds the typed query').toHaveValue('settings');
    // The results listbox stays rendered (filtered live) — we never press Enter on a row.
    await expect(
      page.locator('[data-testid="palette-results"]'),
      'the results list stays visible while filtering',
    ).toBeVisible({ timeout: 4000 });

    await page.keyboard.press('Escape');
    await expect(input, 'Escape closes the palette after filtering').toBeHidden({ timeout: 6000 });
  });

  test('the inline calculator ("= 2+2") evaluates to 4 in the palette', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for the authed admin shell');
    await openAdmin(page);

    await page.keyboard.press('Control+k');
    const input = paletteInput(page);
    await expect(input).toBeVisible({ timeout: 6000 });

    await input.pressSequentially('= 2+2', { delay: 25 });
    const special = page.locator('[data-testid="palette-special"]');
    await expect(special, 'the calculator special-result pane appears').toBeVisible({ timeout: 4000 });
    await expect(special, 'the calculator evaluates 2+2 to 4').toContainText('4');

    await page.keyboard.press('Escape');
  });
});
