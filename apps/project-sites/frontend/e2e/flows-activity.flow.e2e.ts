/**
 * flows-activity.flow.e2e.ts — Surface: the recent-activity feed (feature
 * `activity_feed`) on the /admin getting-started hub.
 *
 * FINISHED this fire: the worker API (`GET /api/activity`) + flag were already
 * live but had NO UI consumer, and `audit_logs` was empty for the test org.
 * Built `<app-recent-activity>` + wired it into the hub + SEEDED 7 realistic
 * activity rows for e2e-test-org (idempotent ids `e2e-act-seed-1..7`):
 * site.published, build.completed, build.failed, domain.added, member.invited,
 * integration.connected, billing.plan_changed.
 *
 * Real testids: recent-activity, recent-activity-count, recent-activity-list,
 * activity-entry (per row, carries a `data-kind` attribute).
 *
 * Run: E2E_API_KEY=$(get-secret E2E_API_KEY) \
 *   npx playwright test --config=playwright.prod.config.ts flows-activity.flow --workers=3
 */
import { test, expect } from '@playwright/test';
import { hasKey, seedSession, gotoAdmin, attachConsole, expectClean, snap, apiFetch } from './_flow-helpers';

const FEED = '[data-testid="recent-activity"]';
const ENTRY = '[data-testid="activity-entry"]';

test.describe('Full-flow · recent activity', () => {
  test.skip(!hasKey, 'E2E_API_KEY not set');
  test.describe.configure({ retries: 2 });
  test.use({ reducedMotion: 'reduce' });

  test('01 the recent-activity feed renders on the /admin hub with a heading + count', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin');
    await expect(page.locator(FEED), 'the activity feed card renders').toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('heading', { name: /recent activity/i })).toBeVisible();
    await expect(page.locator('[data-testid="recent-activity-count"]'), 'the count chip is shown').toBeVisible();
    await snap(page, 'activity-01-feed');
    expectClean(errors);
  });

  test('02 the seeded activity entries render (multiple rows with real summaries)', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin');
    await expect(page.locator(FEED)).toBeVisible({ timeout: 15_000 });
    const rows = page.locator(ENTRY);
    await expect(rows.first()).toBeVisible();
    expect(await rows.count(), 'the seeded feed has several entries').toBeGreaterThanOrEqual(5);
    // A real, specific seeded summary is present.
    await expect(page.locator(FEED)).toContainText(/published urban fitness co/i);
    await snap(page, 'activity-02-entries');
  });

  test('03 ground-truth: the widget entry count reconciles with the API store', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin');
    await expect(page.locator(FEED)).toBeVisible({ timeout: 15_000 });
    const api = await apiFetch<{ data: { id: string }[] }>(page, '/api/activity?limit=8');
    expect(api.status).toBe(200);
    const apiCount = (api.body.data ?? []).length;
    const uiCount = await page.locator(ENTRY).count();
    expect(uiCount, 'display reconciles with store (no lying-empty / no phantom rows)').toBe(apiCount);
    // The visible count chip matches too.
    await expect(page.locator('[data-testid="recent-activity-count"]')).toHaveText(String(apiCount));
  });

  test('04 kind-specific rows render with the correct semantic tone (failed=danger, published=ok)', async ({
    page,
  }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin');
    await expect(page.locator(FEED)).toBeVisible({ timeout: 15_000 });
    // The seeded build.failed row carries a danger dot; site.published carries an ok dot.
    const failed = page.locator(`${ENTRY}[data-kind="build.failed"]`);
    const published = page.locator(`${ENTRY}[data-kind="site.published"]`);
    await expect(failed, 'a build.failed row is present').toBeVisible();
    await expect(failed.locator('.ra-dot--danger'), 'failed row uses the danger tone').toBeVisible();
    await expect(published, 'a site.published row is present').toBeVisible();
    await expect(published.locator('.ra-dot--ok'), 'published row uses the ok tone').toBeVisible();
    await snap(page, 'activity-04-tones');
  });

  test('05 entries show a human relative timestamp (Xh/Xd ago)', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin');
    await expect(page.locator(FEED)).toBeVisible({ timeout: 15_000 });
    // The seeded rows are hours/days old → the meta line carries a relative time.
    await expect(page.locator(FEED)).toContainText(/\b\d+[hd] ago\b|just now|\bm ago\b/i);
  });

  test('06 the multi-kind seed surfaces at least 4 distinct event kinds', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin');
    await expect(page.locator(FEED)).toBeVisible({ timeout: 15_000 });
    const kinds = await page.locator(ENTRY).evaluateAll((els) =>
      Array.from(new Set(els.map((e) => e.getAttribute('data-kind')))).filter(Boolean),
    );
    expect(kinds.length, 'the feed shows a diverse set of activity kinds').toBeGreaterThanOrEqual(4);
  });

  test('07 the activity surface is console-error-free', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin');
    await expect(page.locator(FEED)).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(400);
    expectClean(errors);
  });

  test('08 deep-link + reload preserves the activity feed (session + flag intact)', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin');
    await expect(page.locator(FEED)).toBeVisible({ timeout: 15_000 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator(FEED), 'still there after reload').toBeVisible({ timeout: 15_000 });
    await expect(page).not.toHaveURL(/\/signin/);
  });

  test('09 full journey: land on hub → onboarding + activity both present → activity reflects real events', async ({
    page,
  }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin');
    // The two hub widgets this loop finished both render on the getting-started hub.
    await expect(page.locator('[data-testid="onboarding-checklist"]'), 'onboarding widget present').toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator(FEED), 'activity widget present').toBeVisible();
    // Activity reflects the org's real, persisted events (ground-truth reconciled).
    const api = await apiFetch<{ data: { summary: string }[] }>(page, '/api/activity?limit=8');
    expect(api.status).toBe(200);
    expect((api.body.data ?? []).length, 'the store has persisted activity').toBeGreaterThanOrEqual(5);
    await snap(page, 'activity-09-journey');
    expectClean(errors);
  });
});
