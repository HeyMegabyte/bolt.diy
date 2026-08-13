/**
 * flows-states.flow.e2e.ts — Surface: admin error/recovery states, focused on the
 * admin-scoped 404 (`AdminNotFoundComponent`) — the state a stale bookmark / typo'd
 * or renamed `/admin/*` URL lands in. It renders INSIDE the cockpit (nav + top-bar
 * stay) instead of dropping the user to the public marketing 404.
 *
 * Real selectors (live probe of `sections/not-found.component.ts`):
 *   - `admin-not-found` — the 404 card host (role="status").
 *   - `admin-not-found-home` — "Back to dashboard" → routerLink /admin.
 *   - `admin-not-found-suggest` — "Did you mean <Route>?" pill; renders ONLY when a
 *     close match exists (Levenshtein ≤ length-scaled threshold, OR a renamed route:
 *     ai-logs→traces, github→snapshots). A garbage path shows NO suggest.
 *   - Quick-jump nav: Analytics / Feature Flags / Snapshots links (always present).
 *   - Soft-404: SPA serves HTTP 200 but sets `<meta name="robots" content="noindex,…">`
 *     while mounted.
 *
 * Error-BOUNDARY crash cards (`section-error-*`) are `@if(hasError())`-only — owned by
 * the component's Karma spec (`section-error-boundary.component.spec.ts`); forcing a
 * real crash on prod is non-deterministic, so they are intentionally NOT E2E'd here.
 *
 * Run: E2E_API_KEY=$(get-secret E2E_API_KEY) \
 *   npx playwright test --config=playwright.prod.config.ts flows-states.flow --workers=3
 */
import { test, expect } from '@playwright/test';
import { hasKey, seedSession, gotoAdmin, attachConsole, expectClean, snap, apiFetch } from './_flow-helpers';

// Bogus admin paths that must each render the admin-scoped 404.
const BOGUS_ROUTES = ['zzzqqqzz', 'not-a-real-section', 'flibbertigibbet', 'xyzzy-nope'];

test.describe('Full-flow · states (admin 404 + recovery)', () => {
  test.skip(!hasKey, 'E2E_API_KEY not set');
  test.describe.configure({ retries: 2 });
  test.use({ reducedMotion: 'reduce' });

  test('01 an unknown /admin/* path renders the admin-scoped 404 (not the marketing 404)', async ({
    page,
  }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin/zzzqqqzz');
    await expect(page.locator('[data-testid="admin-not-found"]'), 'the admin 404 card renders').toBeVisible({
      timeout: 15_000,
    });
    // Still INSIDE the cockpit — the user was NOT dropped to the public "search a
    // business" marketing 404. The admin sidebar/nav testids remain reachable.
    const inCockpit = page.locator(
      '[data-testid="user-avatar-btn"], [data-testid="admin-route-announcer"], [data-testid="nav-features"]',
    );
    await expect(inCockpit.first(), 'the 404 stays inside the admin shell').toBeAttached({ timeout: 8_000 });
    await snap(page, 'states-01-admin-404');
    expectClean(errors);
  });

  test('02 the 404 offers "Back to dashboard" and it returns to /admin', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin/zzzqqqzz');
    const home = page.locator('[data-testid="admin-not-found-home"]');
    await expect(home).toBeVisible({ timeout: 15_000 });
    await home.click();
    await expect(page, 'Back-to-dashboard returns to the hub').toHaveURL(/\/admin(\/)?($|\?)/, { timeout: 8_000 });
    await expect(page.locator('[data-testid="admin-not-found"]'), 'the 404 card is gone').toBeHidden();
  });

  test('03 a typo’d route (analitics) suggests Analytics and recovers to it', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin/analitics');
    const suggest = page.locator('[data-testid="admin-not-found-suggest"]');
    await expect(suggest, 'a close typo gets a "Did you mean" pill').toBeVisible({ timeout: 15_000 });
    await expect(suggest, 'it points at Analytics').toContainText(/analytics/i);
    await suggest.click();
    await expect(page, 'the suggestion recovers to the real route').toHaveURL(/\/admin\/analytics/, { timeout: 8_000 });
  });

  test('04 a renamed route (github) suggests Snapshots and recovers to it', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin/github');
    const suggest = page.locator('[data-testid="admin-not-found-suggest"]');
    await expect(suggest, 'a renamed route maps to its new home').toBeVisible({ timeout: 15_000 });
    await expect(suggest).toContainText(/snapshots/i);
    await suggest.click();
    await expect(page).toHaveURL(/\/admin\/snapshots/, { timeout: 8_000 });
  });

  test('05 the renamed route ai-logs still resolves (old bookmark → live surface, not a 404)', async ({
    page,
  }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin/ai-logs');
    // ai-logs is a LIVE (renamed) route — an old bookmark must land on real content,
    // never the admin 404 card.
    await expect(page.locator('[data-testid="admin-not-found"]'), 'ai-logs resolves, not a 404').toHaveCount(0, {
      timeout: 12_000,
    });
    await expect(page).not.toHaveURL(/\/signin/);
  });

  test('06 a typo’d route (billng) suggests Billing', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin/billng');
    const suggest = page.locator('[data-testid="admin-not-found-suggest"]');
    await expect(suggest).toBeVisible({ timeout: 15_000 });
    await expect(suggest).toContainText(/billing/i);
  });

  test('07 a genuinely garbage path shows the 404 but NO misleading suggestion', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin/zzzqqqzz');
    await expect(page.locator('[data-testid="admin-not-found"]')).toBeVisible({ timeout: 15_000 });
    // Nothing is close enough → the "Did you mean" pill must NOT appear (no guessing).
    await expect(page.locator('[data-testid="admin-not-found-suggest"]'), 'garbage gets no false guess').toHaveCount(0);
  });

  test('08 the 404 offers quick-jump links and one navigates (Feature Flags)', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin/zzzqqqzz');
    const card = page.locator('[data-testid="admin-not-found"]');
    await expect(card).toBeVisible({ timeout: 15_000 });
    // Scope to the quick-jump nav INSIDE the 404 card — the cockpit sidebar also
    // carries a Feature Flags link, so an unscoped lookup is ambiguous.
    const jump = card.getByRole('link', { name: /feature flags/i }).first();
    await expect(jump, 'a quick-jump link is offered').toBeVisible();
    await jump.click();
    // /admin/feature-flags is the System-Admin layer; a non-super-admin owner org is
    // redirected to the owner-facing /admin/site-features hub — either is a valid land.
    await expect(page, 'the quick-jump recovers off the 404').toHaveURL(/\/admin\/(feature-flags|site-features)/, {
      timeout: 8_000,
    });
    await expect(page.locator('[data-testid="admin-not-found"]'), 'left the 404').toHaveCount(0);
  });

  test('09 soft-404: the SPA serves 200 but marks the 404 noindex while mounted', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin/zzzqqqzz');
    await expect(page.locator('[data-testid="admin-not-found"]')).toBeVisible({ timeout: 15_000 });
    const robots = await page.locator('meta[name="robots"]').getAttribute('content');
    expect(robots ?? '', 'the admin 404 is noindexed (soft-404 hygiene)').toMatch(/noindex/i);
  });

  for (const route of BOGUS_ROUTES) {
    test(`10.${route} the bogus path "/admin/${route}" renders the 404 card`, async ({ page }) => {
      await seedSession(page);
      await gotoAdmin(page, `/admin/${route}`);
      await expect(page.locator('[data-testid="admin-not-found"]'), `${route} → admin 404`).toBeVisible({
        timeout: 15_000,
      });
    });
  }

  test('11 deep-link a bogus route + reload keeps the 404 (session intact, no signin bounce)', async ({
    page,
  }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin/zzzqqqzz');
    await expect(page.locator('[data-testid="admin-not-found"]')).toBeVisible({ timeout: 15_000 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-testid="admin-not-found"]'), 'still the admin 404 after reload').toBeVisible({
      timeout: 15_000,
    });
    await expect(page, 'not bounced to signin').not.toHaveURL(/\/signin/);
  });

  test('12 the 404 surface is console-error-free', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin/not-a-real-section');
    await expect(page.locator('[data-testid="admin-not-found"]')).toBeVisible({ timeout: 15_000 });
    expectClean(errors);
  });

  test('13 real routes are NOT false-flagged as 404 (a known section renders its own content)', async ({
    page,
  }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin/forms');
    // A real route must never render the 404 card.
    await expect(page.locator('[data-testid="admin-not-found"]'), 'a real route is not a 404').toHaveCount(0, {
      timeout: 12_000,
    });
    await expect(page.getByRole('heading', { name: /forms/i }).first()).toBeVisible({ timeout: 8_000 });
  });

  test('14 full journey: land on a stale link → see 404 → recover via suggestion → real section + auth 200', async ({
    page,
  }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    // Ground truth: the session authorizes even on a 404 route.
    await gotoAdmin(page, '/admin/analitics');
    const me = await apiFetch<Record<string, unknown>>(page, '/api/auth/me');
    expect(me.status).toBe(200);
    await expect(page.locator('[data-testid="admin-not-found"]')).toBeVisible({ timeout: 15_000 });
    const suggest = page.locator('[data-testid="admin-not-found-suggest"]');
    await expect(suggest).toBeVisible();
    await suggest.click();
    await expect(page).toHaveURL(/\/admin\/analytics/, { timeout: 8_000 });
    await expect(page.locator('[data-testid="admin-not-found"]'), 'recovered off the 404').toHaveCount(0);
    await snap(page, 'states-14-journey');
    expectClean(errors);
  });
});
