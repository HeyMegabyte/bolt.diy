/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — the team-invite ACCEPT landing surface
 * (`/admin/accept-invite`, testid `accept-invite-section`) renders + degrades
 * gracefully against LIVE prod in a real session. The stubbed `e2e/admin/accept-invite.spec.ts`
 * (ADMIN-31) already exercises the component's response-handling with MOCKED 410/200 bodies;
 * THIS adds the P0-ADMIN real-prod dimension the mandate requires — a real session mounting the
 * section + the genuinely LIVE accept endpoint rejecting a bogus token.
 *
 * Contract (accept-invite.component.ts):
 *  - No `?token=` in the URL → a deterministic, purely client-side error card: the
 *    warn glyph, "Couldn't accept invite", the message "Missing token in URL.", and a
 *    "Go to admin" recovery button. No network call is made (early return in ngOnInit).
 *  - A bogus `?token=` → POST /api/team/invites/accept (real, authed) → the LIVE
 *    endpoint rejects it (4xx) → the same error card. A bad token can NEVER reach the
 *    "Joined" success state (success requires a 2xx carrying `data.role`), so this
 *    proves the accept endpoint is live AND fails safe — no false success, no crash.
 *
 * Org-agnostic: every assertion holds for ANY authed org (the E2E_API_KEY org needs
 * no seeded invite — the no-token + bogus-token paths are self-contained).
 * Real session (E2E_API_KEY) so the admin shell + section mount authed.
 *
 * @see {@link ../helpers/realdata.ts}
 * @see {@link ./team-interactions.spec.ts} — the team-management surface this completes.
 */
import { test, expect } from '../fixtures.js';
import type { Page } from '@playwright/test';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';

/** Collect real console errors + pageerrors, ignoring benign resource-load noise. */
function attachConsole(page: Page): string[] {
  const errs: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource|net::ERR/i.test(m.text())) errs.push(m.text());
  });
  page.on('pageerror', (e) => errs.push(String(e)));
  return errs;
}

const waitForSection = (page: Page) =>
  page.locator('[data-testid="accept-invite-section"]').waitFor({ state: 'visible', timeout: 15000 });

/** The section's OWN "Go to admin" recovery button — scoped + exact so it never collides
 * with the admin shell topbar's "Go to admin home" button (a strict-mode ambiguity). */
const recoveryBtn = (page: Page) =>
  page.locator('[data-testid="accept-invite-section"]').getByRole('button', { name: /^go to admin$/i });

test.describe('Admin · Accept-invite landing surface (P0-ADMIN)', () => {
  test('no token → the section renders the graceful "missing token" error card (not a 404)', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    const errors = attachConsole(page);
    await setupRealDataPage(page, { passthrough: /\/api\// });
    await page.goto('/admin/accept-invite', { waitUntil: 'domcontentloaded' });
    await waitForSection(page);

    expect(new URL(page.url()).pathname).toBe('/admin/accept-invite');
    await expect(page.locator('[data-testid="accept-invite-section"]'), 'the invite surface mounts').toBeVisible();
    await expect(page.getByText(/couldn.t accept invite/i), 'the error headline renders').toBeVisible({ timeout: 8000 });
    await expect(page.getByText(/missing token in url/i), 'the specific missing-token reason renders').toBeVisible({
      timeout: 8000,
    });
    await expect(recoveryBtn(page), 'a recovery action is offered').toBeVisible();

    const body = (await page.locator('body').innerText()).toLowerCase();
    expect(body.includes("admin page doesn't exist"), 'must not be the admin-404 page').toBe(false);
    await page.screenshot({ path: 'e2e/screenshots/admin-verify/accept-invite-no-token.png' });
    expect(errors, `must render with 0 console errors — saw ${errors.join(' | ')}`).toEqual([]);
  });

  test('the error card is a labelled alert with a working "Go to admin" recovery action', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await setupRealDataPage(page, { passthrough: /\/api\// });
    await page.goto('/admin/accept-invite', { waitUntil: 'domcontentloaded' });
    await waitForSection(page);

    // The error state is announced as an alert (assertive live region) — a11y contract.
    await expect(
      page.locator('[data-testid="accept-invite-section"] [role="alert"]'),
      'the error state is announced to assistive tech',
    ).toBeVisible({ timeout: 8000 });

    // The recovery button returns the user to the admin home (never a dead end).
    // navigateByUrl is async — wait for the SPA route to actually leave accept-invite.
    await recoveryBtn(page).click();
    await page.waitForURL((u) => new URL(u).pathname !== '/admin/accept-invite', { timeout: 8000 });
    expect(new URL(page.url()).pathname, 'the recovery action leaves the accept-invite route').not.toBe(
      '/admin/accept-invite',
    );
  });

  test('a bogus token hits the LIVE accept endpoint and fails safe (4xx → error card, never a false success)', async ({
    page,
  }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    let acceptStatus = 0;
    page.on('response', (res) => {
      if (/\/api\/team\/invites\/accept/.test(res.url())) acceptStatus = res.status();
    });
    // Pass all `/api` through to REAL prod (a benign stub of the accept POST would 200
    // and manufacture a FALSE "Joined"; stubbing /api/sites empty also blocks the admin
    // shell from mounting the section). The live endpoint must reject the bogus token.
    await setupRealDataPage(page, { passthrough: /\/api\// });
    await page.goto('/admin/accept-invite?token=e2e-bogus-token-verify', { waitUntil: 'domcontentloaded' });
    await waitForSection(page);

    // The bogus token settles onto the error card — and NEVER the "Joined" success state.
    await expect(page.getByText(/couldn.t accept invite/i), 'a bad token lands on the error card').toBeVisible({
      timeout: 12000,
    });
    await expect(page.getByText(/^joined$/i), 'a bogus token must NOT reach the success state').toHaveCount(0);
    await expect(recoveryBtn(page)).toBeVisible();

    // Causal proof the section wired to the LIVE endpoint, which rejected the bad token.
    expect(acceptStatus, `the accept endpoint must respond (real, authed) — saw ${acceptStatus}`).toBeGreaterThan(0);
    expect(acceptStatus, `the live endpoint rejects a bogus token (4xx) — saw ${acceptStatus}`).toBeGreaterThanOrEqual(
      400,
    );
    await page.screenshot({ path: 'e2e/screenshots/admin-verify/accept-invite-bogus-token.png' });
  });
});
