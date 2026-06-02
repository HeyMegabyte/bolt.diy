/**
 * @module e2e/admin-dialog-keyboard
 *
 * Keyboard-accessibility contract for DialogShellComponent — the single modal
 * primitive every admin dialog renders through (CLAUDE.md). a11y-focus-trap
 * covers the user-menu trap, but the mandated dialog primitive's keyboard
 * contract (WCAG 2.4.3 focus order, 2.1.2 no-keyboard-trap-escape, 2.4.3 focus
 * restore) was E2E-untested despite having Esc + a CDK ConfigurableFocusTrap.
 *
 * Exercised via /admin/api-tokens → "New Token" → <app-dialog-shell>:
 *   1. opening the dialog moves focus INTO it
 *   2. Tab cycles stay trapped inside the dialog
 *   3. Escape closes it
 *   4. focus is restored to the trigger
 *
 * Seeds `ps_session` from `E2E_API_KEY`. Run:
 *   E2E_API_KEY=psk_test_… npx playwright test --config=playwright.prod.config.ts admin-dialog-keyboard
 */
import { test, expect, type Page } from '@playwright/test';

const KEY = process.env.E2E_API_KEY ?? '';

async function seed(page: Page): Promise<void> {
  await page.addInitScript((k: string) => {
    try {
      localStorage.setItem(
        'ps_session',
        JSON.stringify({ token: k, identifier: 'test@megabyte.space', createdAt: Date.now() }),
      );
      localStorage.setItem('ps_feedback_dismissed', 'true');
    } catch { /* private mode */ }
  }, KEY);
}

const DIALOG = '[role="dialog"][aria-modal="true"]';

test.describe('admin — DialogShell keyboard contract', () => {
  test.skip(!KEY, 'E2E_API_KEY not set');
  test.describe.configure({ retries: 2 });

  test('open moves focus in, Tab stays trapped, Esc closes + restores focus', async ({ page }) => {
    test.setTimeout(60000);
    await seed(page);
    await page.goto('/admin/api-tokens', { waitUntil: 'load' });
    await expect(page.locator('.admin-sidebar, header').first()).toBeVisible({ timeout: 30000 });

    const trigger = page.getByRole('button', { name: /New Token/i }).first();
    await expect(trigger).toBeVisible({ timeout: 15000 });
    await trigger.focus();
    await page.keyboard.press('Enter'); // open via keyboard

    const dialog = page.locator(DIALOG);
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // 1. Focus moved INTO the dialog.
    await expect
      .poll(() => page.evaluate((sel) => {
        const d = document.querySelector(sel);
        return !!(d && document.activeElement && d.contains(document.activeElement));
      }, DIALOG), { timeout: 4000, message: 'focus must move into the dialog on open' })
      .toBe(true);

    // 2. Tab stays trapped inside the dialog (cycle several times).
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab');
      const inside = await page.evaluate((sel) => {
        const d = document.querySelector(sel);
        return !!(d && document.activeElement && d.contains(document.activeElement));
      }, DIALOG);
      expect(inside, `Tab #${i + 1} escaped the dialog focus trap`).toBe(true);
    }

    // 3. Escape closes the dialog.
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0, { timeout: 5000 });

    // 4. Focus restored to the trigger.
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.textContent?.trim() ?? ''), { timeout: 4000 })
      .toMatch(/New Token/i);
  });
});
