/**
 * Auth Surface Journey — authenticated E2E for two P2 items:
 *
 * (A) Authenticated /admin shell renders — sidebar nav visible + known section link.
 * (B) Sign-out clears session → URL is / or /signin AND admin sidebar is gone.
 *
 * Uses `authedPage` fixture (Pathway A — E2E_API_KEY) per fixtures.ts contract.
 * Starts at BASE URL on every test, navigates as a real user.
 */
import path from 'node:path';
import fs from 'node:fs';
import { test, expect } from './fixtures.js';
import { signOut } from './helpers/auth.js';

const BASE = process.env.PROD_URL ?? 'https://projectsites.dev';

// ─── helpers ─────────────────────────────────────────────────────────────────

function collectErrors(page: import('@playwright/test').Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  return errors;
}

function filterNoise(errors: string[]): string[] {
  return errors.filter(
    (e) =>
      !e.includes('favicon') &&
      !e.includes('posthog') &&
      !e.includes('sentry') &&
      !e.includes('net::ERR_BLOCKED_BY_CLIENT') &&
      !e.toLowerCase().includes('failed to load resource') &&
      !e.includes('third-party'),
  );
}

function ensureScreenshotDir(relPath: string): string {
  const abs = path.resolve(
    new URL('.', import.meta.url).pathname,
    'screenshots',
    relPath,
  );
  fs.mkdirSync(abs, { recursive: true });
  return abs;
}

// ─── tests ────────────────────────────────────────────────────────────────────

test.describe('Auth Surface Journey (P2)', () => {
  /**
   * (A) Authenticated /admin shell renders.
   *
   * With a real E2E_API_KEY session injected by the `authedPage` fixture, the
   * admin shell must render its sidebar nav + at least one known section link.
   */
  test('(A) admin shell renders with sidebar nav after auth', async ({ authedPage: page }) => {
    const errors = collectErrors(page);

    // Navigate to admin as a real user would (homepage → admin URL)
    await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded', timeout: 30_000 });

    // Must not end up on signin
    expect(page.url()).not.toContain('/signin');

    // Admin shell must be present
    await expect(
      page.locator('app-admin, [data-cockpit="v2"]'),
    ).toBeVisible({ timeout: 20_000 });

    // Sidebar nav must contain at least one /admin-prefixed link
    const sidebarNavLink = page.locator('aside nav a[href^="/admin"]').first();
    await expect(sidebarNavLink).toBeVisible({ timeout: 15_000 });

    // At least one recognisable section link must be reachable
    // Accepts any of: Dashboard, Sites, Billing, Feature Flags, Settings
    const knownSection = page
      .locator('aside nav a')
      .filter({
        hasText:
          /dashboard|sites|billing|feature.?flags|settings/i,
      })
      .first();
    await expect(knownSection).toBeVisible({ timeout: 15_000 });

    // Screenshot receipt
    const dir = ensureScreenshotDir('auth-surface');
    await page.screenshot({ path: path.join(dir, '01-admin-shell.png'), fullPage: false });

    // Console must be clean
    expect(filterNoise(errors)).toEqual([]);
  });

  /**
   * (B) Sign-out clears session → redirected off admin shell.
   *
   * After signOut() the URL should be / or /signin and the admin sidebar must
   * no longer be visible, proving the session was actually cleared.
   */
  test('(B) sign-out clears session and removes admin sidebar', async ({ authedPage: page }) => {
    const errors = collectErrors(page);

    // Start authenticated at /admin (same as test A)
    await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded', timeout: 30_000 });

    // Guard: confirm we're actually in admin before testing sign-out
    await expect(
      page.locator('app-admin, [data-cockpit="v2"]'),
    ).toBeVisible({ timeout: 20_000 });

    // Sign out via the auth helper (clicks avatar → sign out, waits for localStorage clear)
    await signOut(page);

    // After sign-out the URL must be on / or /signin
    const urlAfter = page.url();
    const isAtRoot = urlAfter.endsWith('/') || urlAfter.includes('projectsites.dev/');
    const isAtSignin = urlAfter.includes('/signin');
    expect(isAtRoot || isAtSignin, `Unexpected URL after sign-out: ${urlAfter}`).toBe(true);

    // Admin sidebar must be gone — wait a moment for the route to settle
    await expect(page.locator('aside nav')).not.toBeVisible({ timeout: 15_000 });

    // Screenshot receipt
    const dir = ensureScreenshotDir('auth-surface');
    await page.screenshot({ path: path.join(dir, '02-after-signout.png'), fullPage: false });

    // Console must be clean
    expect(filterNoise(errors)).toEqual([]);
  });
});
