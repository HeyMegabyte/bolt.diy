/**
 * ADMIN-32 — Share-link dialog (review & approval links)
 *
 * MODERNIZED 2026-07-31 (stale-7 triage). The dedicated `/admin/review-links`
 * page was REMOVED; its contracts moved into {@link ShareLinkDialogComponent}
 * (`components/share-link-dialog/`), opened from the admin navbar Site-actions
 * menu (`site-actions-btn` → `sa-share-link`) and backed by the same
 * `approval_workflow`-gated `/api/sites/:id/review-links` endpoint.
 *
 * Contracts under test (all hard asserts — stubs make every state deterministic):
 *  1. Site-actions menu opens the dialog; create form + expiry presets render.
 *  2. Existing links list renders from GET (nothing lost from the removed page).
 *  3. Expiry preset selection moves aria-pressed (default 7 days).
 *  4. Password toggle reveals the row + auto-generates a ≥6-char passphrase.
 *  5. Create POSTs and swaps to the created view: url + password + copy + reset.
 *  6. Flag OFF (404) → calm `share-link-flag-gate` notice, never an error view.
 *
 * House pattern: authedPage fixture (signInAsTestUser ran inside the fixture);
 * test-body stubs are registered AFTER the helper so Playwright's
 * reverse-registration matching lets them beat the helper's benign catch-all.
 * Glob-law: every route pattern ships its `?**` query twin (bare globs do not
 * match query strings; mid-token `**` cannot cross `/`).
 */

import { test, expect } from '../fixtures.js';
import type { Page } from '@playwright/test';

const BASE = process.env.BASE_URL ?? process.env.PROD_URL ?? 'https://projectsites.dev';

/** Matches the one-site stub in helpers/auth.ts (`selectedSite` = sites[0]). */
const SITE_ID = 'e2e-site-001';

const EXISTING_LINK = {
  id: 'rl-existing-1',
  status: 'pending',
  url: '/review/rl-existing-1',
  expiresAt: '2027-01-01T00:00:00Z',
  usedAt: null,
  passwordProtected: false,
};

/** Console-error collector with the house noise filter (settings-journey idiom). */
function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  return errors;
}

function realErrors(errors: string[]): string[] {
  return errors.filter(
    (e) =>
      !e.includes('favicon') &&
      !e.includes('posthog') &&
      !e.includes('sentry') &&
      !e.includes('net::ERR_BLOCKED_BY_CLIENT') &&
      !e.toLowerCase().includes('failed to load resource') &&
      !e.includes('Http failure') &&
      !e.includes('ChunkLoadError') &&
      !e.includes('Loading chunk'),
  );
}

/**
 * Stubs GET (list) + POST (create) for the review-links endpoint.
 * Registered in the test body — AFTER the authedPage helper's stubs — so these
 * match before the helper's `**\/api\/**` catch-all. `?**` twins per glob-law.
 */
async function stubReviewLinks(page: Page): Promise<void> {
  const handler = async (route: import('@playwright/test').Route): Promise<void> => {
    const method = route.request().method();
    if (method === 'POST') {
      const body = route.request().postDataJSON() as { ttlDays?: number; password?: string };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          id: 'rl-e2e-created',
          url: '/review/rl-e2e-created',
          expiresAt: '2027-01-01T00:00:00Z',
          passwordProtected: !!body?.password,
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, links: [EXISTING_LINK] }),
    });
  };
  await page.route(`**/api/sites/${SITE_ID}/review-links`, handler);
  await page.route(`**/api/sites/${SITE_ID}/review-links?**`, handler);
}

/** Stubs the endpoint as flag-OFF: 404 on every method (server guard returns 404, never 403). */
async function stubReviewLinksFlagOff(page: Page): Promise<void> {
  const handler = async (route: import('@playwright/test').Route): Promise<void> => {
    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Not found' } }),
    });
  };
  await page.route(`**/api/sites/${SITE_ID}/review-links`, handler);
  await page.route(`**/api/sites/${SITE_ID}/review-links?**`, handler);
}

/** Opens /admin and clicks Site actions → Share link. */
async function openShareLinkDialog(page: Page): Promise<void> {
  await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  expect(page.url()).not.toContain('/signin');

  const actionsBtn = page.locator('[data-testid="site-actions-btn"]');
  await expect(actionsBtn, 'Site-actions button needs selectedSite (sites[0] stub)').toBeVisible({
    timeout: 20_000,
  });
  await actionsBtn.click();

  const shareItem = page.locator('[data-testid="sa-share-link"]');
  await expect(shareItem).toBeVisible({ timeout: 10_000 });
  await shareItem.click();
}

test.describe('ADMIN-32 — Share-link dialog (review & approval links)', () => {
  test('create flow: form, existing links, expiry, password, created view', async ({
    authedPage: page,
  }) => {
    const errors = collectConsoleErrors(page);
    await stubReviewLinks(page);
    await openShareLinkDialog(page);

    // 1 — create form renders with the CTA enabled (no password required yet).
    const createBtn = page.locator('[data-testid="share-link-create"]');
    await expect(createBtn).toBeVisible({ timeout: 15_000 });
    await expect(createBtn).toBeEnabled();

    // 2 — the existing-links list (folded in from the removed page) rendered from GET.
    await expect(page.locator('[data-testid="share-link-existing-row"]')).toHaveCount(1, {
      timeout: 10_000,
    });
    await expect(page.locator('[data-testid="share-link-existing-copy"]')).toBeVisible();

    // 3 — expiry presets: default 7 days; selecting 30 moves aria-pressed.
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

    await page.screenshot({ path: 'e2e/screenshots/admin-review-links/01-create-form.png' });

    // 4 — password toggle reveals the row and auto-generates a memorable passphrase.
    await page.locator('[data-testid="share-link-password-toggle"]').check();
    await expect(page.locator('[data-testid="share-link-password-row"]')).toBeVisible();
    const pwInput = page.locator('[data-testid="share-link-password-input"]');
    await expect(pwInput, 'toggle auto-generates a passphrase').not.toHaveValue('');
    const generated = await pwInput.inputValue();
    expect(
      generated.length,
      'auto-generated passphrase must satisfy the min(6) Zod rule',
    ).toBeGreaterThanOrEqual(6);
    await expect(page.locator('[data-testid="share-link-password-generate"]')).toBeVisible();
    await expect(page.locator('[data-testid="share-link-password-show"]')).toBeVisible();

    await page.screenshot({ path: 'e2e/screenshots/admin-review-links/02-password-on.png' });

    // 5 — create → POST → created view with url, password block, copy + reset affordances.
    await expect(createBtn).toBeEnabled();
    await createBtn.click();

    const createdCard = page.locator('[data-testid="share-link-created"]');
    await expect(createdCard).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-testid="share-link-url"]')).toContainText(
      '/review/rl-e2e-created',
    );
    await expect(page.locator('[data-testid="share-link-created-password"]')).toHaveText(generated);
    await expect(page.locator('[data-testid="share-link-copy"]')).toBeVisible();
    await expect(page.locator('[data-testid="share-link-copy-both"]')).toBeVisible();

    await page.screenshot({ path: 'e2e/screenshots/admin-review-links/03-created.png' });

    // 6 — "Create another" resets back to the create form.
    await page.locator('[data-testid="share-link-new"]').click();
    await expect(createBtn).toBeVisible({ timeout: 10_000 });
    await expect(createdCard).toHaveCount(0);

    expect(realErrors(errors)).toHaveLength(0);
  });

  test('flag OFF (404) shows the calm feature-flag gate, never an error view', async ({
    authedPage: page,
  }) => {
    const errors = collectConsoleErrors(page);
    await stubReviewLinksFlagOff(page);
    await openShareLinkDialog(page);

    // The 404 from loadLinks flips flagDisabled → calm notice pointing at Feature Flags.
    const gate = page.locator('[data-testid="share-link-flag-gate"]');
    await expect(gate).toBeVisible({ timeout: 15_000 });
    await expect(gate).toContainText('approval_workflow');

    // The create form must NOT render behind the gate.
    await expect(page.locator('[data-testid="share-link-create"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="share-link-error"]')).toHaveCount(0);

    await page.screenshot({ path: 'e2e/screenshots/admin-review-links/04-flag-gate.png' });

    expect(realErrors(errors)).toHaveLength(0);
  });
});
