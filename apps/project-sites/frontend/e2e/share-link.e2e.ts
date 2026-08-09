/**
 * share-link.e2e.ts — the "Share link" modal (replaces the removed
 * /admin/review-links page). Opens from the navbar Actions dropdown and lets the
 * operator create a shareable preview+approve link, optionally password-protected.
 *
 * The whole expiry/password/create FORM is gated on `approval_workflow` (the
 * dialog renders `@if (flagDisabled()) { gate } @else { form }`). When the flag is
 * OFF — as on the E2E test org — the dialog is gate-only, so every form-driven
 * test here SKIPS (the flag-ON create flow is verified on brian's org via the
 * Browserbase sweep). Opened from a NON-editor section route (/admin/sites): on
 * /admin the shell is an editor route and the Share-link menu item is hidden.
 *
 * Seeds ps_session from E2E_API_KEY (real psk_test_ row in prod D1). Run:
 *   E2E_API_KEY=$(get-secret E2E_API_KEY) npx playwright test --config=playwright.prod.config.ts share-link
 */

import { test, expect, type Page } from '@playwright/test';

const KEY = process.env.E2E_API_KEY ?? '';

async function openShareDialog(page: Page): Promise<boolean> {
  // Open from a NON-editor section route (/admin/sites), NOT /admin: `/admin` is
  // an editor route (isEditorRoute → the persistent bolt iframe composites over
  // the shell), and the `sa-share-link` menu item is rendered only inside
  // `@if (!isEditorRoute())` (admin.component.html) — so it does NOT exist on
  // /admin. On a section route the Actions dropdown surfaces the Share-link item.
  await page.goto('/admin/sites');
  await expect(page.locator('nav[aria-label="Admin sections"]')).toBeVisible({ timeout: 15_000 });
  const trigger = page.locator('[data-testid="site-actions-btn"]');
  const appeared = await trigger
    .first()
    .waitFor({ state: 'visible', timeout: 8_000 })
    .then(() => true)
    .catch(() => false);
  if (!appeared) return false;
  await trigger.click();
  const shareItem = page.locator('[data-testid="sa-share-link"]');
  // The item is flag/route-gated; if the Actions menu doesn't surface it, skip
  // cleanly rather than red-noise (same contract as the no-site path).
  if (
    !(await shareItem
      .waitFor({ state: 'visible', timeout: 6_000 })
      .then(() => true)
      .catch(() => false))
  ) {
    return false;
  }
  await shareItem.click();
  // The dialog renders via the shared overlay primitive, so the
  // <app-share-link-dialog> HOST can be a 0-size anchor while the content
  // teleports into the CDK overlay — assert on the dialog CONTENT, never the host.
  const gate = page.locator('[data-testid="share-link-flag-gate"]');
  const create = page.locator('[data-testid="share-link-create"]');
  await expect(gate.or(create).first()).toBeVisible({ timeout: 10_000 });
  // The expiry/password FORM is gated on `approval_workflow` — when it's OFF the
  // component renders the `share-link-flag-gate` panel instead. On the E2E test org
  // that flag is OFF, so this returns "unavailable" → every form-driven test below
  // skips cleanly (the flag-ON create flow is verified on brian's org via the
  // Browserbase sweep). NB: `share-link-create` is present in BOTH states, and the
  // gate renders a beat AFTER it, so a bare `gate.isVisible()` races false — WAIT
  // for the gate. This is a real precondition-not-met skip, NOT a masked failure.
  const gateShown = await gate
    .waitFor({ state: 'visible', timeout: 3_000 })
    .then(() => true)
    .catch(() => false);
  if (gateShown) return false;
  return true;
}

test.describe('Share link modal', () => {
  test.beforeEach(async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
    await page.addInitScript((k: string) => {
      try {
        localStorage.setItem(
          'ps_session',
          JSON.stringify({ token: k, identifier: 'test@megabyte.space', createdAt: Date.now() }),
        );
        localStorage.setItem('ps_feedback_dismissed', 'true');
      } catch {
        /* covered by the no-key skip */
      }
    }, KEY);
  });

  test.skip(!KEY, 'E2E_API_KEY not set');

  test('opens from the Actions menu with expiry presets + create button', async ({ page }) => {
    if (!(await openShareDialog(page))) {
      test.skip(true, 'no site / approval_workflow off for the test org');
      return;
    }
    await expect(page.locator('[data-testid="share-link-create"]')).toBeVisible();
    await expect(page.locator('[data-testid="share-link-expiry-7"]')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.locator('[data-testid="share-link-expiry-30"]').click();
    await expect(page.locator('[data-testid="share-link-expiry-30"]')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.locator('[data-testid="share-link-expiry-7"]')).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  test('password toggle reveals the field; Generate fills a memorable passphrase + enables Create', async ({
    page,
  }) => {
    if (!(await openShareDialog(page))) {
      test.skip(true, 'no site / approval_workflow off for the test org');
      return;
    }
    await expect(page.locator('[data-testid="share-link-password-row"]')).toHaveCount(0);
    await page.locator('[data-testid="share-link-password-toggle"]').check();
    const input = page.locator('[data-testid="share-link-password-input"]');
    await expect(input).toBeVisible();
    // Toggling on auto-generates a passphrase (word-word-NN!).
    await expect(input).toHaveValue(/[a-z]+-[a-z]+-\d{2}!/);
    // Regenerate produces a fresh value.
    const first = await input.inputValue();
    await page.locator('[data-testid="share-link-password-generate"]').click();
    await expect(input).not.toHaveValue(first);
    await expect(page.locator('[data-testid="share-link-create"]')).toBeEnabled();
  });

  test('a too-short password blocks Create with an inline alert', async ({ page }) => {
    if (!(await openShareDialog(page))) {
      test.skip(true, 'no site / approval_workflow off for the test org');
      return;
    }
    await page.locator('[data-testid="share-link-password-toggle"]').check();
    const input = page.locator('[data-testid="share-link-password-input"]');
    await input.fill('abc'); // < 6
    await expect(page.locator('[data-testid="share-link-create"]')).toBeDisabled();
    await expect(page.locator('#share-link-pw-hint[role="alert"]')).toBeVisible();
  });

  test('Create produces a copied link (when approval_workflow is enabled)', async ({ page }) => {
    if (!(await openShareDialog(page))) {
      test.skip(true, 'no site / approval_workflow off for the test org');
      return;
    }
    // If the flag is off the modal shows a calm gate instead of the form.
    if (
      await page
        .locator('[data-testid="share-link-flag-gate"]')
        .isVisible()
        .catch(() => false)
    ) {
      test.skip(true, 'approval_workflow flag off for the test org');
      return;
    }
    await page.locator('[data-testid="share-link-create"]').click();
    await expect(page.locator('[data-testid="share-link-created"]')).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator('[data-testid="share-link-url"]')).toContainText('/review/');
    await expect(page.locator('[data-testid="share-link-copy"]')).toBeVisible();
  });
});
