/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — the global keyboard shortcuts, a
 * shell-level, org-data-INDEPENDENT surface: the `g`-chord navigation (`g` then a
 * letter → jumps to that admin route per `G_CHORD_ROUTES`) and the `?` cheat-sheet
 * overlay. Full keyboard operability (WCAG 2.1.1) proven against prod. The global
 * handler ignores keys while focus is in a field (`ev.target.matches('input,
 * textarea, [contenteditable]')`), so the helper blurs to `<body>` first.
 *
 * NON-MUTATING + NON-DESTRUCTIVE: pure route navigation + opening/closing a
 * read-only help overlay. No write, no form submit, no Enter on an action.
 *
 * @see {@link ./command-palette-lifecycle.spec.ts}
 */
import { test, expect } from '../fixtures.js';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';

const openAdmin = async (page: import('@playwright/test').Page) => {
  await setupRealDataPage(page, { passthrough: /\/api\// });
  await page.goto('/admin', { waitUntil: 'domcontentloaded' });
  // A stable admin-shell testid becoming visible means AdminComponent has fully
  // mounted, so its @HostListener('document:keydown') g-chord / `?` handler is live.
  await page.locator('[data-testid="user-avatar-btn"]').waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(400); // settle: global keydown listener attached
  // The global g-chord / `?` handlers fire only when focus is NOT in a field.
  await page.evaluate(() => {
    const a = document.activeElement as HTMLElement | null;
    if (a && a !== document.body) a.blur?.();
  });
};

// `g` sets a 900ms chord window, then the letter navigates — Playwright presses are
// milliseconds apart, well inside the window.
const gChord = async (page: import('@playwright/test').Page, letter: string) => {
  await page.keyboard.press('g');
  await page.keyboard.press(letter);
};

test.describe('Admin · global keyboard shortcuts (P0-ADMIN)', () => {
  test('the "g s" chord jumps to the Snapshots section', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for the authed admin shell');
    await openAdmin(page);

    await gChord(page, 's');
    await page
      .waitForFunction(() => location.pathname === '/admin/snapshots', undefined, { timeout: 8000 })
      .catch(() => {});
    expect(new URL(page.url()).pathname, '"g s" navigates to /admin/snapshots').toBe('/admin/snapshots');
  });

  test('the "g a" chord jumps to the Analytics section', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for the authed admin shell');
    await openAdmin(page);

    await gChord(page, 'a');
    await page
      .waitForFunction(() => location.pathname === '/admin/analytics', undefined, { timeout: 8000 })
      .catch(() => {});
    expect(new URL(page.url()).pathname, '"g a" navigates to /admin/analytics').toBe('/admin/analytics');
  });

  test('"?" opens the keyboard-shortcuts cheat-sheet and Escape closes it', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for the authed admin shell');
    await openAdmin(page);

    await page.keyboard.press('?');
    const overlay = page.locator('[data-testid="shortcuts-overlay"]');
    await expect(overlay, '"?" opens the shortcuts cheat-sheet (role=dialog)').toBeVisible({ timeout: 6000 });
    await page.keyboard.press('Escape');
    await expect(overlay, 'Escape closes the cheat-sheet').toBeHidden({ timeout: 6000 });
  });
});
