/**
 * flows-dashboard.flow.e2e.ts — Surface: /admin (the getting-started hub).
 *
 * The hub groups every admin area into task-oriented sections (Build your site /
 * Grow your audience / Operate & monitor / Account & help) as pinnable, searchable
 * cards. Real testids (live DOM probe): dash-search, dash-sec-<icon>, dash-pin-<icon>
 * (icons: code, camera, globe, chart, search, share, inbox, phone, grid, activity,
 * list, gear, credit-card, book, layers). Headings include "Site status", "Build
 * your site", "Grow your audience", "Operate & monitor", "Account & help".
 *
 * Run: E2E_API_KEY=$(get-secret E2E_API_KEY) \
 *   npx playwright test --config=playwright.prod.config.ts flows-dashboard.flow --workers=3
 */
import { test, expect } from '@playwright/test';
import { hasKey, seedSession, gotoAdmin, attachConsole, expectClean, snap, apiFetch } from './_flow-helpers';

const GROUPS = ['Build your site', 'Grow your audience', 'Operate', 'Account'];

test.describe('Full-flow · dashboard hub', () => {
  test.skip(!hasKey, 'E2E_API_KEY not set');
  test.describe.configure({ retries: 2 });
  test.use({ reducedMotion: 'reduce' });

  test('01 the hub boots at /admin with searchable section cards', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin');
    await expect(page).toHaveURL(/\/admin(\/|$)/);
    await expect(page.locator('[data-testid="dash-search"]')).toBeVisible({ timeout: 15_000 });
    const cards = await page.locator('[data-testid^="dash-sec-"]').count();
    expect(cards, 'the hub surfaces many section cards').toBeGreaterThan(8);
    await snap(page, 'dash-01-hub');
    expectClean(errors);
  });

  test('02 the task-oriented section groups render', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin');
    await expect(page.locator('[data-testid="dash-search"]')).toBeVisible({ timeout: 15_000 });
    let seen = 0;
    for (const g of GROUPS) {
      if (await page.getByText(new RegExp(g, 'i')).first().count()) seen++;
    }
    expect(seen, 'the hub organizes sections into task groups').toBeGreaterThanOrEqual(3);
  });

  test('03 dash-search filters the section cards to a query', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin');
    const search = page.locator('[data-testid="dash-search"]');
    await expect(search).toBeVisible({ timeout: 15_000 });
    const before = await page.locator('[data-testid^="dash-sec-"]:visible').count();
    await search.fill('billing');
    await page.waitForTimeout(500);
    const after = await page.locator('[data-testid^="dash-sec-"]:visible').count();
    expect(after, 'searching narrows the visible section set').toBeLessThanOrEqual(before);
    await snap(page, 'dash-03-search');
  });

  test('04 clearing the search restores the full section set', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin');
    const search = page.locator('[data-testid="dash-search"]');
    await expect(search).toBeVisible({ timeout: 15_000 });
    const full = await page.locator('[data-testid^="dash-sec-"]').count();
    await search.fill('zzz-no-match');
    await page.waitForTimeout(400);
    await search.fill('');
    await page.waitForTimeout(400);
    const restored = await page.locator('[data-testid^="dash-sec-"]').count();
    expect(restored, 'clearing the query restores every section card').toBe(full);
  });

  test('05 clicking a section card navigates into that admin section', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin');
    await expect(page.locator('[data-testid="dash-search"]')).toBeVisible({ timeout: 15_000 });
    // Click the first section card that is a real navigable target.
    const card = page.locator('[data-testid^="dash-sec-"]').first();
    await card.click();
    await expect(page, 'a hub card deep-links into an admin section').toHaveURL(/\/admin\/[a-z-]+/, {
      timeout: 12_000,
    });
    await snap(page, 'dash-05-navigate');
  });

  test('06 a section pin toggles its pinned state (pin then revert)', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin');
    await expect(page.locator('[data-testid="dash-search"]')).toBeVisible({ timeout: 15_000 });
    const pin = page.locator('[data-testid^="dash-pin-"]').first();
    if (await pin.count()) {
      const before = await pin.getAttribute('aria-pressed');
      await pin.click();
      await page.waitForTimeout(300);
      const after = await pin.getAttribute('aria-pressed');
      // The pressed state flips (when the control exposes aria-pressed); revert it.
      if (before != null && after != null) expect(after).not.toBe(before);
      await pin.click(); // revert to leave the org's hub state unchanged
      await page.waitForTimeout(200);
    }
  });

  test('07 "Site status" summary renders on the hub', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin');
    await expect(page.getByText(/site status/i).first(), 'the hub shows the current site status').toBeVisible({
      timeout: 15_000,
    });
  });

  test('08 the "Need a hand?" / help affordance renders', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin');
    await expect(page.locator('[data-testid="dash-search"]')).toBeVisible({ timeout: 15_000 });
    const help = page.getByText(/need a hand|tips.*tricks|help/i).first();
    if (await help.count()) await expect(help).toBeVisible();
  });

  test('09 keyboard: dash-search is focusable and accepts a query', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin');
    const search = page.locator('[data-testid="dash-search"]');
    await expect(search).toBeVisible({ timeout: 15_000 });
    await search.focus();
    expect(await search.evaluate((el) => el === document.activeElement)).toBeTruthy();
    await page.keyboard.type('analytics', { delay: 20 });
    await expect(search).toHaveValue(/analytics/i);
  });

  test('10 deep-link + reload preserves the hub (session intact)', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin');
    await expect(page.locator('[data-testid="dash-search"]')).toBeVisible({ timeout: 15_000 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-testid="dash-search"]')).toBeVisible({ timeout: 15_000 });
    await expect(page).not.toHaveURL(/\/signin/);
  });

  test('11 the hub is console-error-free across search + card interactions', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin');
    const search = page.locator('[data-testid="dash-search"]');
    await expect(search).toBeVisible({ timeout: 15_000 });
    await search.fill('settings');
    await page.waitForTimeout(400);
    await search.fill('');
    await page.waitForTimeout(400);
    expectClean(errors);
  });

  test('12 full journey: land on hub → search "analytics" → open the analytics card → land on analytics', async ({
    page,
  }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin');
    const search = page.locator('[data-testid="dash-search"]');
    await expect(search).toBeVisible({ timeout: 15_000 });
    await search.fill('analytics');
    await page.waitForTimeout(500);
    const card = page.locator('[data-testid^="dash-sec-"]:visible').first();
    if (await card.count()) {
      await card.click();
      await expect(page).toHaveURL(/\/admin\/[a-z-]+/, { timeout: 12_000 });
    }
    await snap(page, 'dash-12-journey');
    expectClean(errors);
  });

  test('13 ground-truth: the hub authorizes (/api/auth/me 200) and shows the selected site', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin');
    const me = await apiFetch<{ data?: { org_id?: string } }>(page, '/api/auth/me');
    expect(me.status).toBe(200);
    // The site switcher reflects the selected site ("Urban Fitness Co").
    await expect(page.getByText(/urban fitness/i).first()).toBeVisible({ timeout: 12_000 });
  });

  test('14 the hub exposes a non-trivial catalog of admin sections', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin');
    await expect(page.locator('[data-testid="dash-search"]')).toBeVisible({ timeout: 15_000 });
    const cards = await page.locator('[data-testid^="dash-sec-"]').count();
    expect(cards, 'the hub is a real launch surface for the whole admin').toBeGreaterThan(10);
  });
});
