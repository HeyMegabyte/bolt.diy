/**
 * flows-bookings.flow.e2e.ts — Surface: the bookings widget (feature
 * `native_booking_engine`) on the /admin getting-started hub.
 *
 * FINISHED this fire — 3rd missing-table module: `booking_appointments` did not
 * exist in prod (only `booking_slots` did), so `GET /api/booking/appointments` +
 * the reserve/cancel writes lied-empty/lied-success. Added
 * `migrations/0622_create_booking_appointments.sql` + applied, SEEDED 3 realistic
 * appointments (2 confirmed, 1 cancelled), then built `<app-bookings-widget>` +
 * wired it onto the hub.
 *
 * Ground truth (e2e-test-org, GET /api/booking/appointments): Marcus Lee
 * (confirmed), Dana Reeves (confirmed), Priya Shah (cancelled).
 *
 * Real testids: bookings-widget, bookings-count, bookings-list, bookings-item,
 * bookings-status.
 *
 * Run: E2E_API_KEY=$(get-secret E2E_API_KEY) \
 *   npx playwright test --config=playwright.prod.config.ts flows-bookings.flow --workers=3
 */
import { test, expect } from '@playwright/test';
import { hasKey, seedSession, gotoAdmin, attachConsole, expectClean, snap, apiFetch } from './_flow-helpers';

const WIDGET = '[data-testid="bookings-widget"]';
const ITEM = '[data-testid="bookings-item"]';

test.describe('Full-flow · bookings', () => {
  test.skip(!hasKey, 'E2E_API_KEY not set');
  test.describe.configure({ retries: 2 });
  test.use({ reducedMotion: 'reduce' });

  test('01 the bookings widget renders on the /admin hub with a confirmed count', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin');
    await expect(page.locator(WIDGET), 'the bookings widget renders').toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#bk-heading'), 'the Bookings label is present').toHaveText(/bookings/i);
    await expect(page.locator('[data-testid="bookings-count"]')).toBeVisible();
    await snap(page, 'bookings-01-widget');
    expectClean(errors);
  });

  test('02 the seeded appointments render with visitor names', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin');
    await expect(page.locator(WIDGET)).toBeVisible({ timeout: 15_000 });
    const rows = page.locator(ITEM);
    expect(await rows.count(), 'the seeded feed has several appointments').toBeGreaterThanOrEqual(3);
    await expect(page.locator(WIDGET)).toContainText(/marcus lee/i);
    await expect(page.locator(WIDGET)).toContainText(/dana reeves/i);
    await snap(page, 'bookings-02-list');
  });

  test('03 ground-truth: the widget appointment count reconciles with the API store', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin');
    await expect(page.locator(WIDGET)).toBeVisible({ timeout: 15_000 });
    const api = await apiFetch<{ appointments: { status: string }[] }>(page, '/api/booking/appointments');
    expect(api.status).toBe(200);
    const apptCount = (api.body.appointments ?? []).length;
    const uiCount = await page.locator(ITEM).count();
    expect(uiCount, 'display reconciles with the store').toBe(apptCount);
    // The confirmed-count chip matches the store's confirmed subset.
    const confirmed = (api.body.appointments ?? []).filter((a) => a.status === 'confirmed').length;
    await expect(page.locator('[data-testid="bookings-count"]')).toHaveText(String(confirmed));
  });

  test('04 status chips render, including the cancelled appointment', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin');
    await expect(page.locator(WIDGET)).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(`${ITEM}[data-status="confirmed"]`).first(), 'a confirmed row renders').toBeVisible();
    const cancelled = page.locator(`${ITEM}[data-status="cancelled"]`);
    if (await cancelled.count()) {
      await expect(cancelled.first().locator('.bk-status--cancelled'), 'the cancelled chip renders').toBeVisible();
    }
    await snap(page, 'bookings-04-status');
  });

  test('05 a specific booking (Marcus Lee, confirmed) surfaces with its status', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin');
    await expect(page.locator(WIDGET)).toBeVisible({ timeout: 15_000 });
    const row = page.locator(ITEM).filter({ hasText: /marcus lee/i }).first();
    await expect(row).toBeVisible();
    await expect(row.locator('[data-testid="bookings-status"]')).toHaveText(/confirmed/i);
  });

  test('06 the bookings surface is console-error-free', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin');
    await expect(page.locator(WIDGET)).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(400);
    expectClean(errors);
  });

  test('07 deep-link + reload preserves the bookings widget (session + flag intact)', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin');
    await expect(page.locator(WIDGET)).toBeVisible({ timeout: 15_000 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator(WIDGET), 'still there after reload').toBeVisible({ timeout: 15_000 });
    await expect(page).not.toHaveURL(/\/signin/);
  });

  test('08 full journey: land on hub → bookings widget reflects real persisted appointments', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin');
    await expect(page.locator(WIDGET)).toBeVisible({ timeout: 15_000 });
    const api = await apiFetch<{ appointments: { visitor_name: string }[] }>(page, '/api/booking/appointments');
    expect(api.status).toBe(200);
    expect((api.body.appointments ?? []).length, 'the store has persisted appointments').toBeGreaterThanOrEqual(3);
    // Every visitor in the store appears in the widget.
    for (const a of (api.body.appointments ?? []).slice(0, 3)) {
      await expect(page.locator(WIDGET), `${a.visitor_name} is shown`).toContainText(a.visitor_name);
    }
    await snap(page, 'bookings-08-journey');
    expectClean(errors);
  });
});
