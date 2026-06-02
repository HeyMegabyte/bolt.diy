/**
 * @module e2e/admin-ai-fab
 *
 * Drives the dashboard "upgrades shell" floating AI assistant (FAB) + share-view
 * button to DONE. Regression guard for the convergence fix that replaced:
 *   - the FAB's MOCK echo string with a real `/api/dashboard/chat` SSE stream, and
 *   - the share button's jarring `window.alert()` with a real ToastService toast,
 *   - and removed the unreachable dead bulk-actions toolbar.
 *
 * Asserts (real user actions, from the homepage):
 *   - FAB opens, accepts a prompt, streams a response into the panel.
 *   - The response is NOT the old mock ("Echo for …") — proves it's real now.
 *   - NO native dialog (alert/confirm) ever fires from this shell — proves the
 *     alert()-based fakes are gone.
 *   - Share button produces a toast (no alert).
 *
 * Seeds `ps_session` from `E2E_API_KEY`. Run: `npm run test:e2e:prod`.
 */
import { test, expect } from '@playwright/test';

const KEY = process.env.E2E_API_KEY ?? '';

test.describe('admin AI FAB + share — real, no mock/alert', () => {
  test.describe.configure({ retries: 1 });

  let dialogFired = false;

  test.beforeEach(async ({ page }) => {
    dialogFired = false;
    // Fail loudly if any native dialog appears — the old code used alert().
    page.on('dialog', (d) => {
      dialogFired = true;
      void d.dismiss().catch(() => undefined);
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

  test('FAB streams a real (non-mock) response; no alert dialog', async ({ page }) => {
    // Homepage first, then into the admin shell that hosts the FAB.
    await page.goto('/', { waitUntil: 'load' });
    await page.goto('/admin', { waitUntil: 'load' });

    const fab = page.locator('.adm-fab[data-upgrade="18"]');
    await expect(fab).toBeVisible({ timeout: 15000 });
    await fab.click();

    const panel = page.locator('.adm-fab-panel');
    await expect(panel).toBeVisible();

    await panel.locator('textarea').fill('In one short sentence, what is ProjectSites?');
    const send = page.getByTestId('admin-fab-send');
    await expect(send).toBeEnabled();
    await send.click();

    // A response panel must appear with non-empty text within the stream window.
    const response = page.getByTestId('admin-fab-response');
    await expect(response).toBeVisible({ timeout: 25000 });
    await expect
      .poll(async () => (await response.textContent())?.trim().length ?? 0, { timeout: 25000 })
      .toBeGreaterThan(0);

    const text = (await response.textContent()) ?? '';
    // The defining regression assertion: the old mock literal must NEVER appear.
    expect(text, 'FAB must not render the old mock echo').not.toContain('Echo for');
    expect(text, 'FAB must not render the old mock pointer text').not.toContain(
      'Production wires this',
    );

    expect(dialogFired, 'no native alert/confirm dialog may fire from the shell').toBe(false);
  });

  test('share-view button uses a toast, never alert()', async ({ page }) => {
    await page.goto('/', { waitUntil: 'load' });
    await page.goto('/admin', { waitUntil: 'load' });

    const share = page.locator('.adm-share[data-upgrade="19"]');
    await expect(share).toBeVisible({ timeout: 15000 });
    await share.click();

    // Either a success ("copied") or info (URL) toast — never a native alert.
    const toast = page.locator('[data-testid="toast-item"]').filter({
      hasText: /copied|copy this link/i,
    });
    await expect(toast.first()).toBeVisible({ timeout: 6000 });
    expect(dialogFired, 'share must not use a native alert dialog').toBe(false);
  });
});
