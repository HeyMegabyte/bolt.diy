/**
 * @fileoverview Authenticated Playwright journey — /admin/auth-security.
 *
 * TDD contract:
 *  - `signInAsTestUser(page)` runs FIRST; the Better Auth + audit stubs below
 *    are registered AFTER it so they out-rank the helper's `**\/api/**`
 *    catch-all (Playwright matches routes in REVERSE registration order).
 *    The helper already stubs /api/auth/me — these stubs use EXACT paths:
 *    /api/auth/list-sessions and /api/auth/revoke-session have NO subpaths,
 *    so plain patterns are correct per the glob law (no `/**` twins needed).
 *  - ALL mutations are intercepted; nothing mutates prod.
 *  - Hard assertions, zero console errors (favicon / "failed to load
 *    resource" filtered), a screenshot per step.
 *
 * Coverage:
 *  1. Active-sessions list renders the 2 stubbed Better Auth sessions.
 *  2. Revoke → POST /api/auth/revoke-session fires with that row's token and
 *     the row is removed from the list.
 *  3. 2FA enroll entry point exists and opens its dialog (password step) —
 *     TOTP is deliberately NOT completed; Cancel closes the dialog.
 *  4. Audit-derived metric cards compute from stubbed auth.* audit rows.
 *  5. axe advisory scan (critical-only fails) at 1280 + 375.
 *  6. Console is error-free.
 */

import { test, expect, type Page } from '@playwright/test';
import { signInAsTestUser } from './helpers/auth.js';
import { checkA11y } from './helpers/a11y.js';

const PROD_URL = process.env.PROD_URL ?? 'https://projectsites.dev';

test.use({ serviceWorkers: 'block' });

// ---------------------------------------------------------------------------
// Stub data
// ---------------------------------------------------------------------------

/** Raw-array body — Better Auth's list-sessions returns the array itself. */
const BA_SESSIONS = [
  {
    id: 'ba-sess-1',
    token: 'ba-token-1',
    userId: 'e2e-test-user-id',
    ipAddress: '203.0.113.7',
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
    createdAt: '2026-07-01T10:00:00.000Z',
    updatedAt: '2026-07-29T10:00:00.000Z',
    expiresAt: '2026-08-29T10:00:00.000Z',
  },
  {
    id: 'ba-sess-2',
    token: 'ba-token-2',
    userId: 'e2e-test-user-id',
    ipAddress: '198.51.100.23',
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Mobile/15E148 Safari/604.1',
    createdAt: '2026-07-15T08:30:00.000Z',
    updatedAt: '2026-07-30T08:30:00.000Z',
    expiresAt: '2026-09-15T08:30:00.000Z',
  },
];

/** auth.* audit rows: 3 sign-ins across 2 actors + 1 new-IP anomaly. */
const AUDIT_ROWS = [
  { id: 'al-1', action: 'auth.session.created', message: null, actor_id: 'user_a', created_at: '2026-07-28T09:00:00.000Z' },
  { id: 'al-2', action: 'auth.session.created', message: null, actor_id: 'user_a', created_at: '2026-07-29T09:00:00.000Z' },
  { id: 'al-3', action: 'auth.session.created', message: null, actor_id: 'user_b', created_at: '2026-07-30T09:00:00.000Z' },
  { id: 'al-4', action: 'auth.anomaly.detected', message: 'Sign-in from new_ip', actor_id: 'user_b', created_at: '2026-07-30T09:05:00.000Z' },
  { id: 'al-5', action: 'site.created', message: null, actor_id: 'user_c', created_at: '2026-07-30T10:00:00.000Z' },
];

interface RevokeCapture {
  count: number;
  lastBody: { token?: string } | null;
}

/**
 * Section stubs — MUST be called after `signInAsTestUser` (reverse-match
 * priority). Returns the POST /api/auth/revoke-session capture.
 */
async function stubAuthSecurityApis(page: Page): Promise<RevokeCapture> {
  const capture: RevokeCapture = { count: 0, lastBody: null };

  // Belt-and-braces: swallow ANY mutation on ANY host (PostHog/Sentry beacons
  // included) so the "ALL mutations intercepted" contract holds. Registered
  // FIRST in this fn = matched LAST; the specific stubs below still win.
  await page.route('**', async (route) => {
    if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(route.request().method())) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
      return;
    }
    await route.fallback();
  });

  // Audit rows powering the metric cards.
  // glob-ok: query-suffix only — the component calls /api/audit-logs?limit=500
  // and the endpoint has no subpath routes, so the mid-token ** only ever
  // absorbs the query string (mid-token ** cannot cross '/').
  await page.route('**/api/audit-logs**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: AUDIT_ROWS }),
    });
  });

  // Better Auth list-sessions — cookie-credentialed fetch; body is a RAW array.
  await page.route('**/api/auth/list-sessions', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(BA_SESSIONS),
    });
  });

  // Better Auth revoke-session — counter + body capture; Better Auth replies
  // with a status envelope.
  await page.route('**/api/auth/revoke-session', async (route) => {
    capture.count += 1;
    capture.lastBody = route.request().postDataJSON() as { token?: string };
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":true}' });
  });

  return capture;
}

async function gotoAuthSecurity(page: Page): Promise<void> {
  await page.goto(`${PROD_URL}/admin/auth-security`, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  });
  await expect(page.locator('app-admin, [data-cockpit="v2"]')).toBeVisible({ timeout: 35_000 });
  await expect(page.getByTestId('auth-security-page')).toBeVisible({ timeout: 15_000 });
}

test.describe('Admin — Auth security journey (/admin/auth-security)', () => {
  test('1 — active sessions list renders the 2 stubbed Better Auth sessions', async ({ page }) => {
    await signInAsTestUser(page);
    await stubAuthSecurityApis(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await gotoAuthSecurity(page);

    await expect(page.getByTestId('as-sessions-list')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('as-sessions-count')).toHaveText('(2)');

    // Row 1: Chrome on macOS from the stubbed IP.
    const row1 = page.getByTestId('as-session-row-ba-sess-1');
    await expect(row1).toBeVisible();
    await expect(row1).toContainText('Chrome');
    await expect(row1).toContainText('macOS');
    await expect(row1).toContainText('203.0.113.7');

    // Row 2: Safari on iOS.
    const row2 = page.getByTestId('as-session-row-ba-sess-2');
    await expect(row2).toBeVisible();
    await expect(row2).toContainText('iOS');
    await expect(row2).toContainText('198.51.100.23');

    await page.screenshot({
      path: 'e2e/screenshots/admin-auth-security/01-sessions-list.png',
      fullPage: false,
    });
  });

  test('2 — revoke fires POST /api/auth/revoke-session with the row token and removes the row', async ({ page }) => {
    await signInAsTestUser(page);
    const capture = await stubAuthSecurityApis(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await gotoAuthSecurity(page);

    await expect(page.getByTestId('as-session-row-ba-sess-2')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('as-session-revoke-ba-sess-2').click();

    // The intercepted POST fired once, carrying that row's session token.
    await expect
      .poll(() => capture.count, { message: 'POST /api/auth/revoke-session should fire once' })
      .toBe(1);
    expect(capture.lastBody?.token).toBe('ba-token-2');

    // Row removal is asserted (component prunes locally on success).
    await expect(page.getByTestId('as-session-row-ba-sess-2')).toHaveCount(0);
    await expect(page.getByTestId('as-session-row-ba-sess-1')).toBeVisible();
    await expect(page.getByTestId('as-sessions-count')).toHaveText('(1)');

    await page.screenshot({
      path: 'e2e/screenshots/admin-auth-security/02-session-revoked.png',
      fullPage: false,
    });
  });

  test('3 — 2FA enroll entry point opens its dialog (TOTP NOT completed)', async ({ page }) => {
    await signInAsTestUser(page);
    await stubAuthSecurityApis(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await gotoAuthSecurity(page);

    // Entry point exists.
    const enroll = page.getByTestId('as-2fa-enroll');
    await expect(enroll).toBeVisible({ timeout: 15_000 });
    await page.screenshot({
      path: 'e2e/screenshots/admin-auth-security/03-2fa-entry.png',
      fullPage: false,
    });

    // Opens the dialog with the password step.
    await enroll.click();
    await expect(page.getByTestId('as-2fa-dialog')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('as-2fa-password')).toBeVisible();
    // Continue is disabled until a password is typed — and we deliberately do
    // NOT proceed past this step (no TOTP completion in E2E).
    await expect(page.getByTestId('as-2fa-continue')).toBeDisabled();
    await page.screenshot({
      path: 'e2e/screenshots/admin-auth-security/04-2fa-dialog.png',
      fullPage: false,
    });

    // Cancel closes the dialog.
    await page.getByTestId('as-2fa-cancel').click();
    await expect(page.getByTestId('as-2fa-dialog')).toHaveCount(0);
  });

  test('4 — audit-derived metric cards compute from the stubbed auth.* rows', async ({ page }) => {
    await signInAsTestUser(page);
    await stubAuthSecurityApis(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await gotoAuthSecurity(page);

    await expect(page.getByTestId('auth-security-metrics')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('metric-signins')).toContainText('3');
    await expect(page.getByTestId('metric-anomalies')).toContainText('1');
    // 1 anomaly / 3 sign-ins → 33%.
    await expect(page.getByTestId('metric-anomaly-rate')).toContainText('33%');
    // Reason breakdown parsed from the anomaly message.
    await expect(page.getByTestId('auth-security-reasons')).toContainText('New IP address');
    // The non-auth row (site.created) was filtered out — 2 distinct auth actors.
    await expect(page.getByTestId('metric-actors')).toContainText('2');

    await page.screenshot({
      path: 'e2e/screenshots/admin-auth-security/05-audit-metrics.png',
      fullPage: false,
    });
  });

  test('5 — axe scan (critical-only) at 1280 and 375', async ({ page }) => {
    await signInAsTestUser(page);
    await stubAuthSecurityApis(page);

    for (const width of [1280, 375]) {
      await page.setViewportSize({ width, height: width === 1280 ? 900 : 812 });
      await gotoAuthSecurity(page);
      await expect(page.getByTestId('as-sessions-list')).toBeVisible({ timeout: 15_000 });
      await checkA11y(page, `auth-security-${width}px`);
      await page.screenshot({
        path: `e2e/screenshots/admin-auth-security/06-a11y-${width}.png`,
        fullPage: false,
      });
    }
  });

  test('6 — console is error-free', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await signInAsTestUser(page);
    await stubAuthSecurityApis(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await gotoAuthSecurity(page);
    await expect(page.getByTestId('as-sessions-list')).toBeVisible({ timeout: 15_000 });
    // Exercise the dialog open/close path too.
    await page.getByTestId('as-2fa-enroll').click();
    await expect(page.getByTestId('as-2fa-dialog')).toBeVisible();
    await page.getByTestId('as-2fa-cancel').click();
    await expect(page.getByTestId('as-2fa-dialog')).toHaveCount(0);

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
      path: 'e2e/screenshots/admin-auth-security/07-console-clean.png',
      fullPage: false,
    });
  });
});
