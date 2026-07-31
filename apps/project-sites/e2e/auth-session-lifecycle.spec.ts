/**
 * E2E — Auth Session Lifecycle (Pass 7 convergence)
 *
 * Covers UI contracts for the stub-pathway:
 *  1. Sign-out journey
 *  2. Session-expiry recovery (redirect to /signin?returnUrl=)
 *  3. Rate-limit UX (TDD-RED if 429 is silent)
 *  4. Session persists across page reload
 *
 * Real-session roundtrip (actual magic-link flow) lives in a parallel spec.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { test, expect } from '@playwright/test';
import { signInAsTestUser, gotoAdmin, STUB_TOKEN } from './helpers/auth.js';

// Prevent Service Workers from interfering with route intercepts.
test.use({ serviceWorkers: 'block' });

const PROD_URL = process.env.PROD_URL ?? process.env.BASE_URL ?? 'https://projectsites.dev';
const SCREENSHOTS = path.join('e2e', 'screenshots', 'auth-session-lifecycle');

/** Ensure screenshot directory exists before any test runs. */
test.beforeAll(() => {
  fs.mkdirSync(SCREENSHOTS, { recursive: true });
});

/** Capture a screenshot at a named step (best-effort — never throws). */
async function snap(page: import('@playwright/test').Page, step: string): Promise<void> {
  try {
    await page.screenshot({
      path: path.join(SCREENSHOTS, `${step}.png`),
      fullPage: false,
    });
  } catch {
    // screenshot is advisory; test must not fail due to capture issues
  }
}

// ---------------------------------------------------------------------------
// Test 1 — Sign-out journey (stubbed session)
// ---------------------------------------------------------------------------
test('sign-out clears ps_session and lands on homepage or /signin', async ({ page, context }) => {
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text().toLowerCase();
      // Ignore expected infra noise
      if (
        text.includes('failed to load resource') ||
        text.includes('favicon') ||
        text.includes('net::err_') ||
        text.includes('posthog') ||
        text.includes('sentry')
      ) {
        return;
      }
      consoleErrors.push(msg.text());
    }
  });

  // Inject stub session + stub admin APIs before Angular boots
  await signInAsTestUser(page, { context });

  // Navigate to the admin shell
  await gotoAdmin(page);
  await snap(page, '1-admin-loaded');

  // Open the account menu
  const avatarBtn = page.locator('[data-testid="user-avatar-btn"]');
  await expect(avatarBtn).toBeVisible({ timeout: 10_000 });
  await avatarBtn.click();

  // Wait for the dropdown
  const userMenu = page.locator('[data-testid="user-menu"]');
  await expect(userMenu).toBeVisible({ timeout: 5_000 });
  await snap(page, '1-user-menu-open');

  // Click sign-out
  const signOutBtn = page.locator('[data-testid="user-menu-signout"]');
  await expect(signOutBtn).toBeVisible({ timeout: 5_000 });
  await signOutBtn.click();

  // After sign-out: should be on homepage or /signin
  await page.waitForURL(
    (url) => url.pathname === '/' || url.pathname.includes('signin'),
    { timeout: 10_000 }
  );
  await snap(page, '1-after-signout');

  // ps_session must be cleared from localStorage
  const sessionAfterSignOut = await page.evaluate(() =>
    localStorage.getItem('ps_session')
  );
  expect(sessionAfterSignOut).toBeNull();

  // No unexpected console errors
  expect(consoleErrors, `Unexpected console errors: ${consoleErrors.join('; ')}`).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// Test 2 — Session-expiry recovery
// ---------------------------------------------------------------------------
test('expired session (8 days old) redirects to /signin?returnUrl=/admin', async ({
  page,
  context,
}) => {
  // Inject an EXPIRED session before Angular boots.
  // TTL is 7 days; 8 days → isLoggedIn() returns false → auth guard fires.
  const EIGHT_DAYS_MS = 8 * 24 * 3600 * 1000;
  const expiredSession = JSON.stringify({
    token: STUB_TOKEN,
    identifier: 'test@megabyte.space',
    createdAt: Date.now() - EIGHT_DAYS_MS,
  });

  await context.addInitScript((sessionJson: string) => {
    localStorage.setItem('ps_session', sessionJson);
  }, expiredSession);

  // Navigate directly to /admin
  await page.goto(`${PROD_URL}/admin`, { waitUntil: 'domcontentloaded' });
  await snap(page, '2-after-expired-nav');

  // Auth guard should redirect to /signin with returnUrl
  await page.waitForURL((url) => url.pathname.includes('signin'), { timeout: 10_000 });

  const url = new URL(page.url());
  expect(url.pathname).toMatch(/signin/);

  // returnUrl query param must be present and point back to /admin
  const returnUrl = url.searchParams.get('returnUrl');
  expect(returnUrl).toBeTruthy();
  expect(returnUrl).toContain('/admin');

  await snap(page, '2-signin-with-returnurl');
});

// ---------------------------------------------------------------------------
// Test 3 — Rate-limit UX (TDD-RED: 429 currently silent)
// ---------------------------------------------------------------------------
test('rate-limited magic-link shows friendly error — TDD-RED if silent', async ({ page }) => {
  // Navigate to sign-in page from homepage (real-user navigation)
  await page.goto(`${PROD_URL}/`, { waitUntil: 'domcontentloaded' });
  await snap(page, '3-homepage');

  // Navigate to /signin
  await page.goto(`${PROD_URL}/signin`, { waitUntil: 'domcontentloaded' });
  await snap(page, '3-signin-loaded');

  // Stub magic-link endpoints: 429 from the FIRST call. (A first-call 200 flips
  // the UI into its "link sent" state and the 429 never reaches the user — the
  // old stub tested nothing.)
  // ⚠️ TWO paths must be stubbed. The live /signin page (pages/auth/sign-in
  // .component.ts → auth-api.service) posts to /api/auth/sign-in/magic-link
  // (Better Auth); the legacy path is /api/auth/magic-link. The old pattern
  // only covered the legacy path, so every run's 6 clicks hit REAL prod and
  // sent REAL emails. `message` at the top level is what extractError renders.
  const rateLimited = async (route: import('@playwright/test').Route) => {
    await route.fulfill({
      status: 429,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Too many requests — please wait a minute.' }),
    });
  };
  await page.route('**/api/auth/sign-in/magic-link**', rateLimited);
  await page.route('**/api/auth/magic-link**', rateLimited);

  // Fill in a valid email
  const emailInput = page.locator('input[type="email"]');
  await expect(emailInput).toBeVisible({ timeout: 8_000 });
  await emailInput.fill('test@megabyte.space');

  // Wait until the magic-link button is enabled (requires valid email)
  const submitBtn = page.locator('[data-testid="sign-in-magic-link"]');
  await expect(submitBtn).toBeVisible({ timeout: 5_000 });
  await expect(submitBtn).not.toBeDisabled({ timeout: 5_000 });

  // Click six times rapidly (stop if button becomes disabled between clicks)
  for (let i = 0; i < 6; i++) {
    const isDisabled = await submitBtn.isDisabled();
    if (!isDisabled) {
      await submitBtn.click();
      // Brief yield so Angular signals can update before next click
      await page.waitForTimeout(80);
    }
  }

  await snap(page, '3-after-6-clicks');

  // VERIFIED CONTRACT (Pass 8): the UI DOES surface a friendly message on 429.
  // Visibility is therefore a HARD wait — the old sampled-visibility branch
  // raced the render and tripped a conditional test.fail into
  // "expected-to-fail-but-passed". Readability stays strictly asserted.
  const errorLocator = page.locator('[data-testid="sign-in-error"]');
  await expect(errorLocator, '429 must surface a visible error message').toBeVisible({
    timeout: 10_000,
  });
  const errorText = (await errorLocator.textContent()) ?? '';
  await snap(page, '3-rate-limit-error-visible');
  expect(
    errorText.trim(),
    '429 error must be human-readable, not raw object serialization',
  ).not.toBe('[object Object]');
  expect(errorText.trim().length, 'Error message must be non-empty').toBeGreaterThan(0);
});

// ---------------------------------------------------------------------------
// Test 4 — Session persists across page reload
// ---------------------------------------------------------------------------
test('session persists across full page reload — no bounce to /signin', async ({
  page,
  context,
}) => {
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text().toLowerCase();
      if (
        text.includes('failed to load resource') ||
        text.includes('favicon') ||
        text.includes('net::err_') ||
        text.includes('posthog') ||
        text.includes('sentry')
      ) {
        return;
      }
      consoleErrors.push(msg.text());
    }
  });

  // Sign in via stub pathway
  await signInAsTestUser(page, { context });
  await gotoAdmin(page);
  await snap(page, '4-admin-before-reload');

  // Confirm we are actually on /admin
  expect(page.url()).toContain('/admin');

  // Full page reload
  await page.reload({ waitUntil: 'domcontentloaded' });
  await snap(page, '4-after-reload');

  // Must stay on /admin — no bounce to /signin
  await expect(page).toHaveURL(/\/admin/, { timeout: 10_000 });

  // ps_session must still be present
  const sessionAfterReload = await page.evaluate(() =>
    localStorage.getItem('ps_session')
  );
  expect(sessionAfterReload).not.toBeNull();

  const parsed = JSON.parse(sessionAfterReload as string) as {
    token: string;
    identifier: string;
    createdAt: number;
  };
  expect(parsed.token).toBeTruthy();

  expect(consoleErrors, `Unexpected console errors: ${consoleErrors.join('; ')}`).toHaveLength(0);
});
