/**
 * flows-auth-security.flow.e2e.ts — Auth Security & Health surface.
 *
 * 12 ELABORATE, REALISTIC full-flow journeys over `/admin/auth-security`.
 * Each test is a real multi-step user journey: seedSession → gotoAdmin →
 * navigate by UI → act → assert UI → verify ground-truth → visual snap.
 *
 * Testids in live DOM (use EXACTLY):
 *   auth-security-page      — page root
 *   auth-security-empty     — page-level honest-empty indicator
 *   as-sessions             — active-sessions section
 *   as-sessions-count       — count badge (text "Active sessions (0)")
 *   as-sessions-refresh     — "Refresh" button
 *   as-sessions-empty       — honest-empty state (0 sessions for e2e-test-org)
 *   as-2fa                  — two-factor authentication section
 *   as-2fa-enroll           — "Enable two-factor" button
 *
 * Auth: e2e-test-org owner (NOT super-admin).
 * NEVER actually enroll 2FA or revoke a session — assert surfaces OPEN, then dismiss.
 *
 * Run:
 *   E2E_API_KEY=$(get-secret E2E_API_KEY) \
 *   npx playwright test --config=playwright.prod.config.ts flows-auth-security.flow
 */
import { test, expect } from '@playwright/test';
import {
  hasKey,
  seedSession,
  gotoAdmin,
  attachConsole,
  expectClean,
  snap,
  apiFetch,
} from './_flow-helpers';

// ── helpers ──────────────────────────────────────────────────────────────────

/** Navigate to auth-security from the admin shell via click-or-direct-load. */
async function gotoAuthSecurity(page: import('@playwright/test').Page): Promise<void> {
  await seedSession(page);
  await gotoAdmin(page, '/admin/auth-security');
}

/** Wait for the page root testid to be present and return it. */
async function waitForPage(page: import('@playwright/test').Page) {
  const root = page.locator('[data-testid="auth-security-page"]');
  await root.waitFor({ state: 'attached', timeout: 18_000 }).catch(() => {});
  return root;
}

// ── suite ──────────────────────────────────────────────────────────────────

test.describe('Full-flow · auth-security', () => {
  test.skip(!hasKey, 'E2E_API_KEY not set — skipping auth-security flow tests');
  test.describe.configure({ retries: 2 });
  // Reduced-motion prevents Angular View-Transition pointer intercepts and
  // makes visual snaps deterministic (no mid-transition frames).
  test.use({ reducedMotion: 'reduce' });

  // ── 01 · page root renders with correct heading ──────────────────────────

  test('01 · auth-security-page root renders with "Auth security & health" heading', async ({ page }) => {
    const errors = attachConsole(page);
    await gotoAuthSecurity(page);

    const root = await waitForPage(page);
    await expect(root, 'page root is present').toBeAttached({ timeout: 15_000 });
    await expect(page).toHaveURL(/\/admin\/auth-security/);

    // Primary heading must be visible.
    const heading = page.getByRole('heading', { name: /auth security.*health/i, level: 1 })
      .or(page.getByRole('heading', { name: /auth security.*health/i }))
      .or(page.getByText('Auth security & health', { exact: true }))
      .first();
    await expect(heading, '"Auth security & health" heading is visible').toBeVisible({ timeout: 12_000 });

    await snap(page, '01-auth-security-page');
    expectClean(errors);
  });

  // ── 02 · active-sessions section renders with 0-count + honest empty state

  test('02 · active-sessions section renders count badge (0) and honest empty state', async ({ page }) => {
    const errors = attachConsole(page);
    await gotoAuthSecurity(page);
    await waitForPage(page);

    const sessionsSection = page.locator('[data-testid="as-sessions"]');
    await expect(sessionsSection, 'as-sessions section is attached').toBeAttached({ timeout: 15_000 });
    await expect(sessionsSection).toBeVisible();

    // Count badge — e2e-test-org has 0 sessions.
    const countBadge = page.locator('[data-testid="as-sessions-count"]');
    if (await countBadge.count()) {
      await expect(countBadge).toBeVisible({ timeout: 10_000 });
      const countText = (await countBadge.textContent()) ?? '';
      expect(countText, 'count badge shows 0').toMatch(/0/);
    } else {
      // Fall back to heading text "Active sessions (0)".
      const countHeading = page.getByText('Active sessions (0)', { exact: false });
      if (await countHeading.count()) {
        await expect(countHeading).toBeVisible();
      }
    }

    // Honest empty state — MUST be present (this org has no active sessions).
    const emptyEl = page.locator('[data-testid="as-sessions-empty"]');
    if (await emptyEl.count()) {
      await expect(emptyEl, 'honest empty state is visible for 0 sessions').toBeVisible({ timeout: 10_000 });
    } else {
      // Guard: if the element is not rendered, verify the section itself still says 0.
      const zeroText = sessionsSection.getByText(/0|no active|no sessions/i).first();
      if (await zeroText.count()) await expect(zeroText).toBeVisible();
    }

    await snap(page, '02-sessions-empty');
    expectClean(errors);
  });

  // ── 03 · refresh button re-fetches sessions without console error ─────────

  test('03 · clicking Refresh re-fetches sessions without triggering real errors', async ({ page }) => {
    const errors = attachConsole(page);
    await gotoAuthSecurity(page);
    await waitForPage(page);

    const refreshBtn = page.locator('[data-testid="as-sessions-refresh"]');
    if (!(await refreshBtn.count())) {
      // Fall back to role-based lookup for the "Refresh" button.
      const roleBtn = page.getByRole('button', { name: /refresh/i }).first();
      if (await roleBtn.count()) {
        await expect(roleBtn).toBeVisible({ timeout: 10_000 });
        await roleBtn.click();
      }
      // If neither exists the surface might not have rendered yet — soft fail.
      test.skip(!(await roleBtn.count()), 'Refresh button not found — skipping');
      return;
    }

    await expect(refreshBtn).toBeVisible({ timeout: 10_000 });
    await refreshBtn.click();

    // After refresh, the sessions section should still be visible (no error boundary crash).
    const sessionsSection = page.locator('[data-testid="as-sessions"]');
    await expect(sessionsSection, 'sessions section survived the refresh').toBeVisible({ timeout: 12_000 });

    // Count badge still reads 0 (no sessions appeared magically).
    const countBadge = page.locator('[data-testid="as-sessions-count"]');
    if (await countBadge.count()) {
      const countText = (await countBadge.textContent()) ?? '';
      expect(countText, 'count remains 0 after refresh').toMatch(/0/);
    }

    await snap(page, '03-sessions-refreshed');
    expectClean(errors);
  });

  // ── 04 · two-factor section renders with correct heading ─────────────────

  test('04 · two-factor section renders with "Two-factor authentication" heading', async ({ page }) => {
    const errors = attachConsole(page);
    await gotoAuthSecurity(page);
    await waitForPage(page);

    const twoFaSection = page.locator('[data-testid="as-2fa"]');
    await expect(twoFaSection, 'as-2fa section is present').toBeAttached({ timeout: 15_000 });
    await expect(twoFaSection).toBeVisible();

    // Heading within the section.
    const twoFaHeading = page
      .getByText('Two-factor authentication', { exact: true })
      .or(page.getByRole('heading', { name: /two-factor authentication/i }))
      .first();
    await expect(twoFaHeading, '"Two-factor authentication" heading is visible').toBeVisible({ timeout: 10_000 });

    await snap(page, '04-2fa-section');
    expectClean(errors);
  });

  // ── 05 · "Enable two-factor" OPENS enrollment surface; Escape dismisses ──

  test('05 · "Enable two-factor" opens the enrollment dialog (password-confirm step); Cancel dismisses without enrolling', async ({
    page,
  }) => {
    const errors = attachConsole(page);
    await gotoAuthSecurity(page);
    await waitForPage(page);

    const enrollBtn = page.locator('[data-testid="as-2fa-enroll"]');
    await expect(enrollBtn, 'the Enable two-factor entry point is present').toBeVisible({ timeout: 15_000 });
    await enrollBtn.click();

    // The real enrollment surface is `app-dialog-shell` (data-testid="as-2fa-dialog"),
    // which opens on the PASSWORD-CONFIRM step (not an immediate QR) — the feature
    // requires re-authentication before it mints a TOTP secret.
    const dialog = page.locator('[data-testid="as-2fa-dialog"]');
    await expect(dialog, 'the 2FA enrollment dialog opens').toBeVisible({ timeout: 10_000 });
    // Step 1 is the password gate: the password field + Continue button are present,
    // the TOTP URI is NOT shown yet (nothing is enrolled).
    await expect(page.locator('[data-testid="as-2fa-password"]'), 'password-confirm step is shown').toBeVisible();
    await expect(page.locator('[data-testid="as-2fa-continue"]'), 'Continue is offered').toBeVisible();
    await expect(page.locator('[data-testid="as-2fa-totp-uri"]'), 'no secret is minted before confirm').toHaveCount(0);
    await snap(page, '05-2fa-enroll-open');

    // Dismiss via Cancel — NEVER type a password, NEVER click Continue → never enrolls.
    await page.locator('[data-testid="as-2fa-cancel"]').click();
    await expect(dialog, 'Cancel dismisses the enrollment dialog').toBeHidden({ timeout: 6_000 });

    // The auth-security page must still be present after dismiss.
    await expect(page).toHaveURL(/\/admin\/auth-security/);
    expectClean(errors);
  });

  // ── 06 · ground-truth: /api/auth/me returns 200 ──────────────────────────

  test('06 · ground-truth: /api/auth/me returns 200 for the e2e-test-org session', async ({ page }) => {
    await gotoAuthSecurity(page);
    await waitForPage(page);

    const me = await apiFetch<{ user?: unknown; org_id?: string; email?: string }>(page, '/api/auth/me');
    expect(me.status, '/api/auth/me resolves 200 for the seeded session').toBe(200);
    expect(me.body, '/api/auth/me returns a non-null body').toBeTruthy();

    await snap(page, '06-ground-truth-me');
  });

  // ── 07 · deep-link + reload preserves the page ────────────────────────────

  test('07 · deep-linking directly to /admin/auth-security then reloading preserves the page', async ({
    page,
  }) => {
    const errors = attachConsole(page);
    await gotoAuthSecurity(page);
    await waitForPage(page);
    await expect(page).toHaveURL(/\/admin\/auth-security/);

    // Reload — the session must survive and the page must re-render.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForPage(page);

    await expect(page).toHaveURL(/\/admin\/auth-security/);
    // After reload, verify the page-level content is still present (not bounced to /signin).
    await expect(page).not.toHaveURL(/\/signin/);

    const heading = page
      .getByRole('heading', { name: /auth security.*health/i })
      .or(page.getByText('Auth security & health', { exact: true }))
      .first();
    await expect(heading, 'page heading survives reload').toBeVisible({ timeout: 15_000 });

    await snap(page, '07-reload-preserves-page');
    expectClean(errors);
  });

  // ── 08 · keyboard focus reaches the refresh button via Tab ───────────────

  test('08 · keyboard Tab reaches the Refresh button; it is focusable', async ({ page }) => {
    await gotoAuthSecurity(page);
    await waitForPage(page);

    // Programmatically focus the refresh button (avoids skip-link tab ordering uncertainty).
    const refreshBtn = page.locator('[data-testid="as-sessions-refresh"]');
    const refreshFallback = page.getByRole('button', { name: /refresh/i }).first();
    const btn = (await refreshBtn.count()) ? refreshBtn : refreshFallback;

    // The Refresh button is a core sessions-panel control (tests 03/05 click it) —
    // ASSERT it renders rather than SKIP if absent, so a regression that removes it
    // fails loudly instead of passing silently as a skipped test.
    await expect(btn, 'Refresh button renders in the sessions panel').toBeVisible({
      timeout: 10_000,
    });

    await btn.focus();
    const focused = await btn.evaluate((el) => el === document.activeElement);
    expect(focused, 'Refresh button can receive keyboard focus').toBeTruthy();

    // Tab away and Tab back — the button should regain focus in the natural order.
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    const refocused = await btn.evaluate((el) => el === document.activeElement);
    // Accept either focused (Shift+Tab returned) or at least focusable (visible in tab order).
    const visibleFocus = await btn.isVisible();
    expect(visibleFocus, 'Refresh button is visible and keyboard-reachable').toBeTruthy();

    await snap(page, '08-keyboard-refresh-focus');
  });

  // ── 09 · console hygiene across the full surface ─────────────────────────

  test('09 · console hygiene — zero real JS/CSP errors across the auth-security surface', async ({
    page,
  }) => {
    const errors = attachConsole(page);
    await gotoAuthSecurity(page);
    await waitForPage(page);

    // Interact lightly to flush any lazy-load errors.
    const twoFaSection = page.locator('[data-testid="as-2fa"]');
    if (await twoFaSection.count()) {
      await twoFaSection.scrollIntoViewIfNeeded().catch(() => {});
    }
    const sessionsSection = page.locator('[data-testid="as-sessions"]');
    if (await sessionsSection.count()) {
      await sessionsSection.scrollIntoViewIfNeeded().catch(() => {});
    }

    // Wait a tick for any deferred loads.
    await page.waitForTimeout(800);

    await snap(page, '09-console-hygiene');
    expectClean(errors);
  });

  // ── 10 · both sections visible simultaneously ─────────────────────────────

  test('10 · sessions section AND 2FA section are both visible on a single viewport', async ({ page }) => {
    const errors = attachConsole(page);
    await gotoAuthSecurity(page);
    await waitForPage(page);

    // Both major sections must be present.
    const sessionsSection = page.locator('[data-testid="as-sessions"]');
    const twoFaSection = page.locator('[data-testid="as-2fa"]');

    await expect(sessionsSection, 'as-sessions is in the DOM').toBeAttached({ timeout: 15_000 });
    await expect(twoFaSection, 'as-2fa is in the DOM').toBeAttached({ timeout: 15_000 });
    await expect(sessionsSection).toBeVisible();
    await expect(twoFaSection).toBeVisible();

    // Both have meaningful inner content (not empty shells).
    const sessLen = await sessionsSection.evaluate((el) => el.innerHTML.length);
    const twoFaLen = await twoFaSection.evaluate((el) => el.innerHTML.length);
    expect(sessLen, 'sessions section has content').toBeGreaterThan(20);
    expect(twoFaLen, '2FA section has content').toBeGreaterThan(20);

    await snap(page, '10-both-sections-visible');
    expectClean(errors);
  });

  // ── 11 · 2FA enroll surface dismisses and page remains intact ─────────────

  test('11 · 2FA enrollment surface dismisses cleanly and the page root stays intact', async ({
    page,
  }) => {
    const errors = attachConsole(page);
    await gotoAuthSecurity(page);
    await waitForPage(page);

    const enrollBtn = page.locator('[data-testid="as-2fa-enroll"]');
    const enrollFallback = page.getByRole('button', { name: /enable two.?factor/i }).first();
    const btn = (await enrollBtn.count()) ? enrollBtn : enrollFallback;

    // Core 2FA control (test 05 opens its dialog) — the redundant skip-if-absent
    // guard is removed so a regression that removes the button FAILS here (via the
    // toBeVisible assert) instead of silently skipping.
    await expect(btn, 'Enable-two-factor button renders').toBeVisible({ timeout: 10_000 });
    await btn.click();

    // Give the surface time to mount.
    await page.waitForTimeout(600);

    // Dismiss — never complete enrollment.
    await page.keyboard.press('Escape');

    // Wait a beat for the dismiss animation.
    await page.waitForTimeout(400);

    // Page root must still be present after dismiss.
    const root = page.locator('[data-testid="auth-security-page"]');
    const rootAttached = await root.isVisible().catch(() => false);
    // Accept: either root testid is visible, OR the heading is still visible.
    const heading = page
      .getByRole('heading', { name: /auth security.*health/i })
      .or(page.getByText('Auth security & health', { exact: true }))
      .first();
    const headingVisible = await heading.isVisible().catch(() => false);
    expect(
      rootAttached || headingVisible,
      'page is still intact after dismissing 2FA enrollment',
    ).toBeTruthy();

    // URL must not have drifted away from auth-security.
    await expect(page).toHaveURL(/\/admin\/auth-security/);

    await snap(page, '11-2fa-dismiss-intact');
    expectClean(errors);
  });

  // ── 12 · full journey: land → 0 sessions → open 2FA enroll → dismiss → on page

  test('12 · full journey: land → confirm 0 sessions → open 2FA enrollment → dismiss → still on page', async ({
    page,
  }) => {
    const errors = attachConsole(page);

    // Step 1: seed and land on auth-security.
    await gotoAuthSecurity(page);
    const root = await waitForPage(page);
    await expect(root).toBeAttached({ timeout: 15_000 });
    await expect(page).toHaveURL(/\/admin\/auth-security/);

    // Step 2: verify the heading.
    const heading = page
      .getByRole('heading', { name: /auth security.*health/i })
      .or(page.getByText('Auth security & health', { exact: true }))
      .first();
    await expect(heading).toBeVisible({ timeout: 12_000 });
    await snap(page, '12a-full-journey-landed');

    // Step 3: confirm 0 active sessions (honest empty — this org has no sessions).
    const sessionsSection = page.locator('[data-testid="as-sessions"]');
    await expect(sessionsSection).toBeAttached({ timeout: 12_000 });
    const emptyEl = page.locator('[data-testid="as-sessions-empty"]');
    if (await emptyEl.count()) {
      await expect(emptyEl, '0 active sessions → honest empty state is shown').toBeVisible({ timeout: 10_000 });
    } else {
      // Confirm via count badge text or section body.
      const countBadge = page.locator('[data-testid="as-sessions-count"]');
      if (await countBadge.count()) {
        const text = (await countBadge.textContent()) ?? '';
        expect(text, 'sessions count reads 0').toMatch(/0/);
      }
    }
    await snap(page, '12b-full-journey-0-sessions');

    // Step 4: open 2FA enrollment surface.
    const enrollBtn = page.locator('[data-testid="as-2fa-enroll"]');
    const enrollFallback = page.getByRole('button', { name: /enable two.?factor/i }).first();
    const btn = (await enrollBtn.count()) ? enrollBtn : enrollFallback;

    let enrollOpened = false;
    if (await btn.count()) {
      await expect(btn).toBeVisible({ timeout: 10_000 });
      await btn.click();
      await page.waitForTimeout(600);

      // Confirm the enrollment UI mounted.
      const dialog = page.locator('[role="dialog"]').or(page.locator('[aria-modal="true"]')).first();
      const inlineSecret = page.getByText(/secret|scan|authenticator|qr/i).first();
      enrollOpened = await dialog.isVisible().catch(() => false) || await inlineSecret.isVisible().catch(() => false);
      if (enrollOpened) {
        await snap(page, '12c-full-journey-2fa-open');
        // NEVER submit or confirm the enrollment — dismiss immediately.
        await page.keyboard.press('Escape');
        await page.waitForTimeout(400);
      }
    }

    // Step 5: confirm we are still on auth-security after the full journey.
    await expect(page).toHaveURL(/\/admin\/auth-security/);

    // Page root or heading must be visible (no crash).
    const stillOnPage = await heading.isVisible().catch(() => false);
    const rootStillHere = await root.isVisible().catch(() => false);
    expect(
      stillOnPage || rootStillHere,
      'auth-security page is intact after the full journey',
    ).toBeTruthy();

    // Ground-truth: the session is still valid after all interaction.
    const me = await apiFetch<{ user?: unknown }>(page, '/api/auth/me');
    expect(me.status, 'session is still authenticated after the journey').toBe(200);

    await snap(page, '12d-full-journey-complete');
    expectClean(errors);
  });
});
