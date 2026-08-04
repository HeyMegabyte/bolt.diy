/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — the two universal admin KEYBOARD
 * affordances: the Cmd/Ctrl+K COMMAND PALETTE and the `?` SHORTCUTS OVERLAY.
 *
 * Both are mounted in `AdminComponent` (present on every /admin/* route) and are
 * purely client-side (open/filter/close driven by signals + a static command
 * list) → INSTANT + load-independent → robust under parallel prod load (see
 * [[admin-verify-e2e-authoring-gotchas]] #5). A new interaction type for the
 * suite: global keyboard shortcut → overlay dialog → filter → Escape-close.
 *
 * Palette contract (pages/admin/command-palette.component.ts):
 *   - Cmd/Ctrl+K opens it (its own `window:keydown`); `[data-testid="palette-input"]`
 *     (combobox), `[data-testid="palette-results"]` (listbox),
 *     `[data-testid^="palette-action-"]` per command. Escape closes.
 * Shortcuts contract (components/shortcuts-overlay + admin shell `document:keydown`):
 *   - `?` (when not in a field) opens `[data-testid="shortcuts-overlay"]`; Escape closes.
 *
 * Real session (E2E_API_KEY) so /admin mounts authed.
 *
 * @see {@link ../helpers/realdata.ts}
 * @see {@link ./apps-category-keyboard.spec.ts} — the other keyboard-interaction spec.
 */
import { test, expect } from '../fixtures.js';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';

test.describe('Admin · command palette + shortcuts overlay (P0-ADMIN)', () => {
  test('Cmd/Ctrl+K opens the palette, typing filters commands, Escape closes it', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await setupRealDataPage(page, { passthrough: /\/api\// });
    await page.goto('/admin', { waitUntil: 'domcontentloaded' });
    // Let the shell mount so the palette's window:keydown listener is live.
    await page
      .waitForFunction(() => (document.querySelector('main')?.innerText ?? '').trim().length > 200, { timeout: 15000 })
      .catch(() => {});

    const input = page.locator('[data-testid="palette-input"]');
    const results = page.locator('[data-testid="palette-results"]');

    // Cmd/Ctrl+K (the palette listens for either modifier).
    await page.keyboard.press('ControlOrMeta+k');
    await expect(input, 'Cmd/Ctrl+K must open the command palette').toBeVisible({ timeout: 6000 });
    await expect(results, 'the palette must show its command listbox').toBeVisible({ timeout: 6000 });

    // Typing a nav term filters the static command list (client-side, instant).
    await input.fill('settings');
    await expect(input).toHaveValue('settings');
    await expect(
      results.getByText(/settings/i).first(),
      'typing "settings" must surface a matching command',
    ).toBeVisible({ timeout: 6000 });

    // Escape closes the palette (focus restored to the page).
    await page.keyboard.press('Escape');
    await expect(input, 'Escape must close the command palette').toBeHidden({ timeout: 6000 });
  });

  test('selecting a palette command navigates to that section (the palette WORKS, not just opens)', async ({
    page,
  }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await setupRealDataPage(page, { passthrough: /\/api\// });
    await page.goto('/admin', { waitUntil: 'domcontentloaded' });
    await page
      .waitForFunction(() => (document.querySelector('main')?.innerText ?? '').trim().length > 200, { timeout: 15000 })
      .catch(() => {});

    await page.keyboard.press('ControlOrMeta+k');
    const input = page.locator('[data-testid="palette-input"]');
    await expect(input).toBeVisible({ timeout: 6000 });

    // Filter to the Logs section, then execute that command → route changes.
    await input.fill('logs');
    const logsAction = page
      .locator('[data-testid="palette-results"] [data-testid^="palette-action-"]')
      .filter({ hasText: /log/i })
      .first();
    await expect(logsAction, 'a Logs command must appear for "logs"').toBeVisible({ timeout: 6000 });
    await logsAction.click();

    // The palette executed a real navigation command.
    await expect(page, 'selecting the Logs command must navigate to /admin/logs').toHaveURL(/\/admin\/logs/, {
      timeout: 8000,
    });
    await expect(input, 'the palette must close after executing a command').toBeHidden({ timeout: 6000 });
  });

  test('the "?" key opens the shortcuts cheat-sheet; Escape closes it', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await setupRealDataPage(page, { passthrough: /\/api\// });
    await page.goto('/admin', { waitUntil: 'domcontentloaded' });
    await page
      .waitForFunction(() => (document.querySelector('main')?.innerText ?? '').trim().length > 200, { timeout: 15000 })
      .catch(() => {});

    // Focus the page body (not an input) so the shell's `?` handler fires.
    await page.locator('body').click({ position: { x: 4, y: 4 } });

    const overlay = page.locator('[data-testid="shortcuts-overlay"]');

    // Shift+Slash produces "?" — the documented "show cheat-sheet" shortcut.
    await page.keyboard.press('Shift+Slash');
    await expect(overlay, 'the "?" key must open the shortcuts overlay').toBeVisible({ timeout: 6000 });

    // It's the real cheat-sheet — it lists keyboard keys (<kbd> elements).
    await expect(overlay.locator('kbd').first(), 'the shortcuts overlay must list keyboard keys').toBeVisible({
      timeout: 6000,
    });

    await page.keyboard.press('Escape');
    await expect(overlay, 'Escape must close the shortcuts overlay').toBeHidden({ timeout: 6000 });
  });
});
