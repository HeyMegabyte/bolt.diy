/**
 * @module e2e/admin-confirm-dialog
 *
 * Verifies the branded {@link ConfirmService} that replaced native
 * `window.confirm()` across destructive admin actions (feature-flags killswitch,
 * domains remove-hostname, settings remove-member, ai-endpoints/ide delete, media
 * delete + bulk-delete, env-vars delete).
 *
 * Exercised SAFELY against live prod on the feature-flags killswitch (the most
 * destructive action): open the confirm → Esc → Cancel. The accept button is
 * NEVER clicked, and a network guard asserts no killswitch POST fires, so no real
 * flag is ever killed. Also asserts NO native dialog appears (proves the native
 * confirm() is gone) and the deployed bundle carries the branded wiring.
 *
 * Seeds `ps_session` from `E2E_API_KEY`. Run: `npm run test:e2e:prod`.
 */
import { test, expect } from '@playwright/test';

const KEY = process.env.E2E_API_KEY ?? '';

test.describe('admin ConfirmService — branded confirm, no native confirm()', () => {
  test.describe.configure({ retries: 1 });

  let nativeDialogFired = false;
  let killswitchPosted = false;

  test.beforeEach(async ({ page }) => {
    nativeDialogFired = false;
    killswitchPosted = false;
    page.on('dialog', (d) => {
      nativeDialogFired = true;
      void d.dismiss().catch(() => undefined);
    });
    // Guard: fail if a real killswitch mutation ever leaves the browser.
    page.on('request', (r) => {
      if (/\/api\/super-admin\/feature-flags/.test(r.url()) && r.method() === 'POST') {
        killswitchPosted = true;
      }
    });
    await page.addInitScript((k: string) => {
      try {
        localStorage.setItem(
          'ps_session',
          JSON.stringify({ token: k, identifier: 'test@megabyte.space', createdAt: Date.now() }),
        );
      } catch {
        /* ignore */
      }
    }, KEY);
  });

  test.skip(!KEY, 'E2E_API_KEY not set');

  test('killswitch opens the branded confirm; Esc + Cancel dismiss it (no native dialog, no mutation)', async ({
    page,
  }) => {
    await page.goto('/', { waitUntil: 'load' });
    await page.goto('/admin/feature-flags', { waitUntil: 'load' });

    const killBtn = page.locator('.ff-btn-danger').first();
    await expect(killBtn).toBeVisible({ timeout: 15000 });

    // 1) Open → branded dialog appears with the real, route-accurate message.
    await killBtn.click();
    const message = page.getByTestId('confirm-message');
    await expect(message).toBeVisible({ timeout: 5000 });
    await expect(message).toContainText(/kill/i);
    await expect(page.getByTestId('confirm-accept')).toBeVisible();
    await expect(page.getByTestId('confirm-cancel')).toBeVisible();

    // 2) Esc closes it (CDK overlay) — no action taken.
    await page.keyboard.press('Escape');
    await expect(message).toBeHidden({ timeout: 5000 });

    // 3) Reopen → Cancel button closes it.
    await killBtn.click();
    await expect(message).toBeVisible({ timeout: 5000 });
    await page.getByTestId('confirm-cancel').click();
    await expect(message).toBeHidden({ timeout: 5000 });

    // Safety + correctness invariants.
    expect(nativeDialogFired, 'no native confirm()/alert() may fire — must be the branded dialog').toBe(
      false,
    );
    expect(killswitchPosted, 'cancelling/Esc must NOT execute the killswitch mutation').toBe(false);
  });

  test('confirm dialog traps focus and restores it to the trigger on close (WCAG)', async ({
    page,
  }) => {
    await page.goto('/', { waitUntil: 'load' });
    await page.goto('/admin/feature-flags', { waitUntil: 'load' });

    const killBtn = page.locator('.ff-btn-danger').first();
    await expect(killBtn).toBeVisible({ timeout: 15000 });
    await killBtn.focus();

    await killBtn.click();
    await expect(page.getByTestId('confirm-message')).toBeVisible({ timeout: 5000 });

    // Focus must move INTO the dialog (cdkFocusInitial → the accept button).
    const focusInsideDialog = await page.evaluate(() => {
      const overlay = document.querySelector('.cdk-overlay-container');
      return !!overlay && overlay.contains(document.activeElement);
    });
    expect(focusInsideDialog, 'focus must move into the dialog when it opens').toBe(true);

    // Tab stays trapped within the dialog (focus never escapes to the page behind).
    await page.keyboard.press('Tab');
    const stillTrapped = await page.evaluate(() => {
      const overlay = document.querySelector('.cdk-overlay-container');
      return !!overlay && overlay.contains(document.activeElement);
    });
    expect(stillTrapped, 'Tab must stay trapped inside the dialog').toBe(true);

    // Esc closes and restores focus to the trigger.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('confirm-message')).toBeHidden({ timeout: 5000 });
    await expect(killBtn).toBeFocused();

    expect(nativeDialogFired).toBe(false);
    expect(killswitchPosted).toBe(false);
  });
});
