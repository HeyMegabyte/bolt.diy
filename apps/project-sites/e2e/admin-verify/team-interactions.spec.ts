/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — the Team section (`/admin/team`):
 * members list + seat usage + invite form. Coverage gap closed this fire — the
 * section had a unit spec but no admin-verify E2E against PROD.
 *
 * Enumerated read-only (directive #1). The invite email field is exercised across
 * the full value-domain set (directive #3: empty / invalid / injection-shaped /
 * valid) — that validation is pure client-side so it's robust regardless of which
 * org the E2E session resolves to. Structural gates (team-page + one-of members/
 * empty/loading + seat "N of M") are org-agnostic (E2E_API_KEY ≠ brian's org, per
 * [[e2e-api-key-is-not-brians-account]] / gotcha #4) — assert presence, not counts.
 * Non-mutating: never actually invites or removes a member.
 *
 * Team's get-full-organization is wired to live D1 custom auth (see
 * [[better-auth-sections-need-custom-d1-endpoints]] — ✅ team DONE).
 *
 * @see {@link ../helpers/realdata.ts}
 */
import { test, expect } from '../fixtures.js';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';

const goto = async (page: import('@playwright/test').Page) => {
  await setupRealDataPage(page, { passthrough: /\/api\// });
  await page.goto('/admin/team', { waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="team-page"]').waitFor({ state: 'visible', timeout: 15000 });
};

test.describe('Admin · Team members + seats + invite (P0-ADMIN)', () => {
  test('renders the team surface with seat usage + a members/empty/loading state', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await goto(page);
    expect(new URL(page.url()).pathname).toBe('/admin/team');

    // Seat usage renders as "N of M" (org-agnostic — could be 1 of 1 on a free org).
    const seats = page.locator('[data-testid="team-seats"]');
    await expect(seats, 'seat usage renders').toBeVisible({ timeout: 10000 });
    expect(
      /\d+\s+of\s+\d+/i.test((await seats.innerText()).trim()),
      'seat usage shows an "N of M" count',
    ).toBe(true);

    // The members area resolves to ONE honest state — a populated list, a calm
    // "no members" empty state, or a still-settling loader — never a crash.
    const state = await Promise.race([
      page
        .locator('[data-testid="team-members"]')
        .waitFor({ state: 'visible', timeout: 9000 })
        .then(() => 'members'),
      page
        .locator('[data-testid="team-members-empty"]')
        .waitFor({ state: 'visible', timeout: 9000 })
        .then(() => 'empty'),
      page
        .locator('[data-testid="team-loading"]')
        .waitFor({ state: 'visible', timeout: 9000 })
        .then(() => 'loading'),
    ]).catch(() => 'none');
    expect(['members', 'empty', 'loading'], `team members render an honest state (saw: ${state})`).toContain(
      state,
    );
  });

  test('invite email field validates the full value-domain (empty / invalid / injection / valid)', async ({
    page,
  }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await goto(page);

    const email = page.locator('[data-testid="team-invite-email"]');
    const err = page.locator('[data-testid="team-invite-email-error"]');
    const submit = page.locator('[data-testid="team-invite-submit"]');
    await expect(email, 'the invite email field renders').toBeVisible({ timeout: 10000 });

    // Empty → submit is never enabled (emailValid() false).
    await expect(submit, 'submit disabled with an empty email').toBeDisabled();

    // Invalid + injection-shaped inputs → the field error shows, submit stays disabled.
    for (const bad of ['notanemail', 'foo bar@baz', '<script>@x']) {
      await email.fill(bad);
      await email.blur();
      await expect(err, `"${bad}" is rejected with a visible field error`).toBeVisible({ timeout: 4000 });
      await expect(submit, `"${bad}" keeps submit disabled`).toBeDisabled();
    }

    // Valid email → the field error clears (submit may still be disabled when the
    // free org is at its seat limit — that's the gated affordance, asserted below).
    await email.fill('teammate@example.com');
    await email.blur();
    await expect(err, 'a valid email clears the field error').toBeHidden({ timeout: 4000 });
  });

  test('the invite control reflects the seat entitlement (gated when full, usable otherwise)', async ({
    page,
  }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await goto(page);

    await page.locator('[data-testid="team-invite-email"]').fill('teammate@example.com');
    await page.locator('[data-testid="team-invite-email"]').blur();

    // Two honest outcomes: the org is at its seat cap → the seats-full notice shows
    // AND submit is disabled (plan-gated); OR there's spare capacity → submit is
    // enabled with a valid email. Either is correct — a broken form would be neither.
    const full = await page
      .locator('[data-testid="team-seats-full"]')
      .isVisible()
      .catch(() => false);
    const submit = page.locator('[data-testid="team-invite-submit"]');
    if (full) {
      await expect(submit, 'at the seat cap the invite is gated (disabled)').toBeDisabled();
    } else {
      await expect(submit, 'with spare seats + a valid email the invite is usable').toBeEnabled({
        timeout: 4000,
      });
    }
  });
});
