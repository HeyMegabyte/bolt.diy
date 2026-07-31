/**
 * @fileoverview Authenticated Playwright journey — /admin/user (user settings).
 *
 * TDD contract:
 *  - `signInAsTestUser(page)` runs FIRST; every section stub below is
 *    registered AFTER it so it out-ranks the helper's catch-alls (Playwright
 *    matches routes in REVERSE registration order).
 *  - ALL mutations are intercepted — the helper's `**\/api/**` catch-all plus
 *    a belt-and-braces any-host mutation guard here. Nothing mutates prod.
 *  - Hard assertions, zero console errors (favicon / "failed to load
 *    resource" filtered), a screenshot per step.
 *
 * Coverage:
 *  1. Profile card renders the stubbed identity (email + derived display name).
 *  2. Edit display name → Save → PATCH /api/admin/profile fires EXACTLY once
 *     with the typed value; saved flash + heading update + localStorage persist.
 *  3. Value domains (TDD Contract #10) — empty / overlong-300 / injection-shaped
 *     are rejected (disabled submit OR inline error; PATCH never fires).
 *  4. Value domains — valid + unicode/emoji values save with exact round-trip.
 *  5. Server-stub 400 is surfaced inline (rejection contract, third form).
 *  6. axe advisory scan (critical-only fails) at 1280 + 375.
 *  7. Console is error-free.
 */

import { test, expect, type Page } from '@playwright/test';
import { signInAsTestUser } from './helpers/auth.js';
import { checkA11y } from './helpers/a11y.js';

const PROD_URL = process.env.PROD_URL ?? 'https://projectsites.dev';
const TEST_EMAIL = process.env.E2E_USER_EMAIL ?? 'test@megabyte.space';

/** Mirrors AdminUserSettingsComponent.displayName() for the stubbed email. */
const EXPECTED_DERIVED_NAME = (TEST_EMAIL.split('@')[0] ?? TEST_EMAIL)
  .replace(/[._-]+/g, ' ')
  .replace(/\b\w/g, (c) => c.toUpperCase());

test.use({ serviceWorkers: 'block' });

interface PatchCapture {
  count: number;
  lastBody: { name?: string } | null;
}

/**
 * Section stubs — MUST be called after `signInAsTestUser` (reverse-match
 * priority). Returns a live capture for the PATCH /api/admin/profile counter.
 */
async function stubUserSettingsApis(
  page: Page,
  opts?: { profileStatus?: number },
): Promise<PatchCapture> {
  const capture: PatchCapture = { count: 0, lastBody: null };

  // Belt-and-braces: swallow ANY mutation on ANY host (PostHog/Sentry beacons
  // included). /api/* mutations are already fulfilled by the helper's
  // catch-all; this guarantees the "ALL mutations intercepted" contract.
  // Registered FIRST in this fn = matched LAST, so specific stubs still win.
  await page.route('**', async (route) => {
    if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(route.request().method())) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
      return;
    }
    await route.fallback();
  });

  // API keys list — a real empty list renders the calm empty state instead of
  // the retry card the helper's shapeless `{}` catch-all would trigger.
  // No subpath twin needed for the LIST (revoke/rotate hit /api/admin/api-keys/:id,
  // which this plain pattern cannot match — they fall to the mutation stubs).
  await page.route('**/api/admin/api-keys', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"data":[]}' });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
  });

  // Personal sessions list rendered lower on the page — one current device.
  await page.route('**/api/admin/sessions', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: [
          {
            id: 'sess-current',
            device: 'MacBook Pro',
            browser: 'Chromium',
            os: 'macOS',
            location: 'Newark, NJ',
            last_active_at: new Date().toISOString(),
            current: true,
          },
        ],
      }),
    });
  });

  // PATCH /api/admin/profile — the display-name save. Counter + body capture.
  // Plain pattern is correct per the glob law: the endpoint has NO subpaths.
  await page.route('**/api/admin/profile', async (route) => {
    if (route.request().method() === 'PATCH') {
      capture.count += 1;
      capture.lastBody = route.request().postDataJSON() as { name?: string };
      const status = opts?.profileStatus ?? 200;
      if (status === 200) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
      } else {
        await route.fulfill({
          status,
          contentType: 'application/json',
          body: JSON.stringify({
            error: { code: 'VALIDATION_ERROR', message: 'That display name is not allowed.' },
          }),
        });
      }
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  return capture;
}

async function gotoUserSettings(page: Page): Promise<void> {
  await page.goto(`${PROD_URL}/admin/user`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await expect(page.locator('app-admin, [data-cockpit="v2"]')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('us-profile-card')).toBeVisible({ timeout: 15_000 });
}

test.describe('Admin — User settings journey (/admin/user)', () => {
  test('1 — profile card renders the stubbed identity', async ({ page }) => {
    await signInAsTestUser(page);
    const capture = await stubUserSettingsApis(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await gotoUserSettings(page);

    // Stubbed email is visible in the profile card.
    await expect(page.getByTestId('us-profile-email')).toContainText(TEST_EMAIL);
    // Heading shows the email-derived display name (fresh context = no override).
    await expect(page.getByTestId('us-display-name-heading')).toHaveText(EXPECTED_DERIVED_NAME);
    // Input is prefilled with the same derived name.
    await expect(page.getByTestId('us-display-name-input')).toHaveValue(EXPECTED_DERIVED_NAME);
    // A valid prefilled draft means Save is enabled.
    await expect(page.getByTestId('us-display-name-save')).toBeEnabled();
    // Nothing has fired yet.
    expect(capture.count).toBe(0);

    await page.screenshot({
      path: 'e2e/screenshots/admin-user-settings/01-profile-renders.png',
      fullPage: false,
    });
  });

  test('2 — edit display name → save PATCHes exactly once with the typed value', async ({ page }) => {
    await signInAsTestUser(page);
    const capture = await stubUserSettingsApis(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await gotoUserSettings(page);

    const input = page.getByTestId('us-display-name-input');
    const save = page.getByTestId('us-display-name-save');

    await input.fill('Playwright QA');
    await expect(save).toBeEnabled();
    await save.click();

    // The intercepted PATCH fired exactly once, carrying the typed value.
    await expect
      .poll(() => capture.count, { message: 'PATCH /api/admin/profile should fire once' })
      .toBe(1);
    expect(capture.lastBody?.name).toBe('Playwright QA');

    // Saved flash + heading update + local persist.
    await expect(page.getByTestId('us-display-name-saved')).toContainText('Saved');
    await expect(page.getByTestId('us-display-name-heading')).toHaveText('Playwright QA');
    const stored = await page.evaluate(() => localStorage.getItem('ps_display_name'));
    expect(stored).toBe('Playwright QA');

    await page.screenshot({
      path: 'e2e/screenshots/admin-user-settings/02-saved.png',
      fullPage: false,
    });
  });

  test('3 — value domains: empty, overlong-300, and injection-shaped are rejected', async ({ page }) => {
    await signInAsTestUser(page);
    const capture = await stubUserSettingsApis(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await gotoUserSettings(page);

    const input = page.getByTestId('us-display-name-input');
    const save = page.getByTestId('us-display-name-save');
    const error = page.getByTestId('us-display-name-error');

    // Empty → disabled submit (rejection contract; never click a disabled button).
    await input.fill('');
    await expect(save).toBeDisabled();
    await expect(error).toHaveCount(0);
    await page.screenshot({
      path: 'e2e/screenshots/admin-user-settings/03-empty-disabled.png',
      fullPage: false,
    });

    // Overlong (300 chars, no maxlength clamp) → inline error + disabled submit.
    await input.fill('N'.repeat(300));
    await expect(input).toHaveValue('N'.repeat(300));
    await expect(error).toBeVisible();
    await expect(error).toContainText('80 characters or fewer');
    await expect(save).toBeDisabled();
    await page.screenshot({
      path: 'e2e/screenshots/admin-user-settings/04-overlong-error.png',
      fullPage: false,
    });

    // Injection-shaped → inline error + disabled submit.
    await input.fill('<script>alert(1)</script>');
    await expect(error).toBeVisible();
    await expect(error).toContainText('markup or script-like');
    await expect(save).toBeDisabled();
    await page.screenshot({
      path: 'e2e/screenshots/admin-user-settings/05-injection-error.png',
      fullPage: false,
    });

    // No rejected state ever reached the wire.
    expect(capture.count).toBe(0);
  });

  test('4 — value domains: valid + unicode/emoji round-trips exactly', async ({ page }) => {
    await signInAsTestUser(page);
    const capture = await stubUserSettingsApis(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await gotoUserSettings(page);

    const input = page.getByTestId('us-display-name-input');
    const save = page.getByTestId('us-display-name-save');

    // Plain valid value is accepted (control case).
    await input.fill('Ada Lovelace');
    await expect(page.getByTestId('us-display-name-error')).toHaveCount(0);
    await expect(save).toBeEnabled();

    // Unicode + emoji is VALID and round-trips byte-exact through the PATCH.
    await input.fill('Café Owner 🚀');
    await expect(page.getByTestId('us-display-name-error')).toHaveCount(0);
    await expect(save).toBeEnabled();
    await save.click();

    await expect.poll(() => capture.count).toBe(1);
    expect(capture.lastBody?.name).toBe('Café Owner 🚀');
    await expect(page.getByTestId('us-display-name-heading')).toHaveText('Café Owner 🚀');

    await page.screenshot({
      path: 'e2e/screenshots/admin-user-settings/06-emoji-saved.png',
      fullPage: false,
    });
  });

  test('5 — server-stub 400 is surfaced inline and does NOT persist', async ({ page }) => {
    await signInAsTestUser(page);
    const capture = await stubUserSettingsApis(page, { profileStatus: 400 });
    await page.setViewportSize({ width: 1280, height: 900 });
    await gotoUserSettings(page);

    const input = page.getByTestId('us-display-name-input');
    await input.fill('Blocked Name');
    await page.getByTestId('us-display-name-save').click();

    await expect.poll(() => capture.count).toBe(1);
    // The server's message is surfaced inline (rejection contract, form 3).
    const error = page.getByTestId('us-display-name-error');
    await expect(error).toBeVisible();
    await expect(error).toContainText('That display name is not allowed.');
    // The rejected value was NOT persisted — heading keeps the derived name.
    await expect(page.getByTestId('us-display-name-heading')).toHaveText(EXPECTED_DERIVED_NAME);
    const stored = await page.evaluate(() => localStorage.getItem('ps_display_name'));
    expect(stored).toBeNull();
    // Typing again clears the server rejection.
    await input.fill('Recovered Name');
    await expect(error).toHaveCount(0);

    await page.screenshot({
      path: 'e2e/screenshots/admin-user-settings/07-server-400.png',
      fullPage: false,
    });
  });

  test('6 — axe scan (critical-only) at 1280 and 375', async ({ page }) => {
    await signInAsTestUser(page);
    await stubUserSettingsApis(page);

    for (const width of [1280, 375]) {
      await page.setViewportSize({ width, height: width === 1280 ? 900 : 812 });
      await gotoUserSettings(page);
      await checkA11y(page, `user-settings-${width}px`);
      await page.screenshot({
        path: `e2e/screenshots/admin-user-settings/08-a11y-${width}.png`,
        fullPage: false,
      });
    }
  });

  test('7 — console is error-free', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await signInAsTestUser(page);
    await stubUserSettingsApis(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await gotoUserSettings(page);
    // Exercise the primary interaction once so handler paths are covered too.
    await page.getByTestId('us-display-name-input').fill('Console Check');
    await page.getByTestId('us-display-name-save').click();
    await expect(page.getByTestId('us-display-name-heading')).toHaveText('Console Check');

    const realErrors = errors.filter(
      (e) =>
        !e.includes('favicon') &&
        !e.toLowerCase().includes('failed to load resource') &&
        !e.includes('third-party') &&
        !e.includes('posthog') &&
        !e.includes('sentry'),
    );
    expect(realErrors, `Console errors:\n${realErrors.join('\n')}`).toEqual([]);

    await page.screenshot({
      path: 'e2e/screenshots/admin-user-settings/09-console-clean.png',
      fullPage: false,
    });
  });
});
