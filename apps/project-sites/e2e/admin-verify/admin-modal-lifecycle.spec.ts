/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — the shared modal primitive
 * (`DialogShellComponent`, which EVERY admin modal uses) works: opens, moves focus
 * INTO the dialog, traps Tab, and closes on Escape. A11y-load-bearing (WCAG 2.4.3
 * focus order + 2.1.2 no keyboard trap-out).
 *
 * NON-MUTATING + NON-DESTRUCTIVE: only OPENS a create dialog + presses Escape/Tab —
 * NEVER submits, so nothing is created. The dialog is detected via `[role="dialog"]`
 * (DialogShell renders `role="dialog" aria-modal="true"`; Escape closes via a
 * `@HostListener('document:keydown.escape')`; focus is trapped on `.dialog-panel`).
 *
 * @see {@link ../helpers/site-context.ts}
 */
import { test, expect } from '../fixtures.js';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';
import { selectFirstSite } from '../helpers/site-context.js';

const dialog = (page: import('@playwright/test').Page) => page.locator('[role="dialog"]');
const focusIsInsideDialog = (page: import('@playwright/test').Page) =>
  page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));

test.describe('Admin · modal lifecycle (DialogShell) (P0-ADMIN)', () => {
  test('the API-token create modal opens, focuses inside, and closes on Escape', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await setupRealDataPage(page, { passthrough: /\/api\// });
    await page.goto('/admin/api-tokens', { waitUntil: 'domcontentloaded' });
    const open = page.locator('[data-testid="at-create-open"]');
    await open.waitFor({ state: 'visible', timeout: 15000 });

    await open.click();
    await expect(dialog(page), 'the modal opens (role=dialog)').toBeVisible({ timeout: 6000 });
    // Focus moved into the dialog (DialogShell focuses the first body field).
    await expect
      .poll(() => focusIsInsideDialog(page), { timeout: 4000 })
      .toBe(true);

    await page.keyboard.press('Escape');
    await expect(dialog(page), 'Escape closes the modal').toBeHidden({ timeout: 6000 });
  });

  test('Tab keeps focus trapped inside the open modal', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await setupRealDataPage(page, { passthrough: /\/api\// });
    await page.goto('/admin/api-tokens', { waitUntil: 'domcontentloaded' });
    await page.locator('[data-testid="at-create-open"]').waitFor({ state: 'visible', timeout: 15000 });
    await page.locator('[data-testid="at-create-open"]').click();
    await expect(dialog(page)).toBeVisible({ timeout: 6000 });

    // Cycle Tab several times — focus must never escape the dialog (CDK focus trap).
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab');
      expect(await focusIsInsideDialog(page), `Tab #${i + 1} keeps focus in the dialog`).toBe(true);
    }
    await page.keyboard.press('Escape');
  });

  test('a site-scoped create modal (snapshots) opens + Escape-closes', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await setupRealDataPage(page, { passthrough: /\/api\// });
    await page.goto('/admin/snapshots', { waitUntil: 'domcontentloaded' });
    await page
      .locator('[data-testid="snapshot-create-button"]')
      .waitFor({ state: 'visible', timeout: 15000 })
      .catch(() => {});
    test.skip(!(await selectFirstSite(page)), 'no site to enable the snapshot create button');

    const open = page.locator('[data-testid="snapshot-create-button"]');
    await open.click();
    await expect(dialog(page), 'the snapshot modal opens').toBeVisible({ timeout: 6000 });
    await page.keyboard.press('Escape');
    await expect(dialog(page), 'Escape closes the snapshot modal').toBeHidden({ timeout: 6000 });
  });
});
