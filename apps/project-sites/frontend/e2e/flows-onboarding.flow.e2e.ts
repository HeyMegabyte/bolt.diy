/**
 * flows-onboarding.flow.e2e.ts — Surface: the onboarding activation checklist
 * (feature `onboarding_copilot`) on the /admin getting-started hub.
 *
 * FINISHED this fire: the worker API (`GET /api/onboarding/checklist`,
 * `POST /api/onboarding/dismiss`) + flag were already live, but NOTHING consumed
 * them — no UI. Built the `<app-onboarding-checklist>` component + wired it into
 * the dashboard hub. The API IS the flag gate (404 when off → widget renders
 * nothing), so the widget only shows for orgs the flag is on for.
 *
 * Ground truth (e2e-test-org, GET /api/onboarding/checklist): dismissed:false,
 * complete:false, steps = [create_site✓, publish_site✓, add_custom_domain✓,
 * invite_or_explore✗(next)]. So the widget renders 3/4 done with invite_or_explore
 * as the recommended next action.
 *
 * Real testids: onboarding-checklist, onboarding-progress, onboarding-step-<id>,
 * onboarding-next-cta, onboarding-dismiss.
 *
 * DISMISS SAFETY: POST /api/onboarding/dismiss persists to KV for 1 YEAR, which
 * would hide the widget for the shared test org on every future run. The dismiss
 * test MOCKS that endpoint (route.fulfill) so it proves the optimistic-hide UX
 * WITHOUT the persistent side-effect.
 *
 * Run: E2E_API_KEY=$(get-secret E2E_API_KEY) \
 *   npx playwright test --config=playwright.prod.config.ts flows-onboarding.flow --workers=3
 */
import { test, expect } from '@playwright/test';
import { hasKey, seedSession, gotoAdmin, attachConsole, expectClean, snap, apiFetch } from './_flow-helpers';

const CHECKLIST = '[data-testid="onboarding-checklist"]';

test.describe('Full-flow · onboarding checklist', () => {
  test.skip(!hasKey, 'E2E_API_KEY not set');
  test.describe.configure({ retries: 2 });
  test.use({ reducedMotion: 'reduce' });

  test('01 the checklist renders on the /admin hub with its heading + progress', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin');
    await expect(page.locator(CHECKLIST), 'the onboarding checklist card renders').toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('heading', { name: /finish setting up your site/i })).toBeVisible();
    await expect(page.locator('[data-testid="onboarding-progress"]'), 'the progress indicator is shown').toBeVisible();
    await snap(page, 'onboarding-01-render');
    expectClean(errors);
  });

  test('02 all four activation steps render with correct done/next states', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin');
    await expect(page.locator(CHECKLIST)).toBeVisible({ timeout: 15_000 });
    // The three completed steps are present + marked done; the fourth is the next action.
    for (const id of ['create_site', 'publish_site', 'add_custom_domain', 'invite_or_explore']) {
      await expect(page.locator(`[data-testid="onboarding-step-${id}"]`), `step ${id} renders`).toBeVisible();
    }
    // invite_or_explore is the recommended next step → it carries the highlight class.
    await expect(page.locator('[data-testid="onboarding-step-invite_or_explore"]')).toHaveClass(/oc-step--next/);
    await expect(page.locator('[data-testid="onboarding-step-create_site"]')).toHaveClass(/oc-step--done/);
    await snap(page, 'onboarding-02-steps');
  });

  test('03 the progress reflects the real done-count (3 of 4) from the API', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin');
    await expect(page.locator(CHECKLIST)).toBeVisible({ timeout: 15_000 });
    // Reconcile display vs store: the API's done-count must equal what the widget shows.
    const api = await apiFetch<{ steps: { done: boolean }[] }>(page, '/api/onboarding/checklist');
    expect(api.status).toBe(200);
    const doneFromApi = (api.body.steps ?? []).filter((s) => s.done).length;
    const total = (api.body.steps ?? []).length;
    const progressText = (await page.locator('[data-testid="onboarding-progress"]').innerText()).replace(/\s/g, '');
    expect(progressText, 'the widget progress matches the store').toContain(`${doneFromApi}/${total}`);
  });

  test('04 the recommended next step exposes a CTA that points at a REAL admin route', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin');
    await expect(page.locator(CHECKLIST)).toBeVisible({ timeout: 15_000 });
    const cta = page.locator('[data-testid="onboarding-next-cta"]');
    await expect(cta, 'the next-action CTA renders').toBeVisible();
    const href = await cta.getAttribute('href');
    // The component remaps stale backend cta_urls (/admin/sites, /admin/domains → 404)
    // to real routes; the invite/explore CTA resolves under /admin/settings.
    expect(href ?? '', 'the CTA points at a real route (not a dead /admin/sites path)').toMatch(/\/admin\/settings|\/admin($|#)|\/create/);
    expect(href ?? '', 'the CTA is NOT a known dead route').not.toMatch(/\/admin\/sites|\/admin\/domains/);
  });

  test('05 clicking the next-action CTA navigates to its destination', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin');
    await expect(page.locator(CHECKLIST)).toBeVisible({ timeout: 15_000 });
    const cta = page.locator('[data-testid="onboarding-next-cta"]');
    await cta.click();
    // The invite/explore CTA lands on settings (a real route) — never the admin 404.
    await expect(page).toHaveURL(/\/admin\/settings/, { timeout: 8_000 });
    await expect(page.locator('[data-testid="admin-not-found"]'), 'the CTA did not land on a 404').toHaveCount(0);
    await snap(page, 'onboarding-05-cta-nav');
  });

  test('06 Dismiss hides the checklist (optimistic) — dismiss endpoint MOCKED to protect shared state', async ({
    page,
  }) => {
    await seedSession(page);
    // MOCK the dismiss endpoint so the real 1-year KV dismissal is never written for
    // the shared e2e-test-org (would hide the widget on every future run).
    let dismissCalled = false;
    await page.route('**/api/onboarding/dismiss', async (route) => {
      dismissCalled = true;
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"dismissed":true}' });
    });
    await gotoAdmin(page, '/admin');
    await expect(page.locator(CHECKLIST)).toBeVisible({ timeout: 15_000 });
    await page.locator('[data-testid="onboarding-dismiss"]').click();
    await expect(page.locator(CHECKLIST), 'the checklist hides after Dismiss').toBeHidden({ timeout: 6_000 });
    expect(dismissCalled, 'the dismiss request was issued (and mocked)').toBeTruthy();
  });

  test('07 ground-truth: the checklist API authorizes (200) and the widget reflects a not-dismissed state', async ({
    page,
  }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin');
    const api = await apiFetch<{ dismissed: boolean; complete: boolean }>(page, '/api/onboarding/checklist');
    expect(api.status).toBe(200);
    // Since the store says not-dismissed + not-complete, the widget must be visible
    // (display reconciles with store — no lying-empty).
    if (!api.body.dismissed && !api.body.complete) {
      await expect(page.locator(CHECKLIST), 'store says active → widget is shown').toBeVisible({ timeout: 12_000 });
    }
  });

  test('08 the onboarding surface is console-error-free', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin');
    await expect(page.locator(CHECKLIST)).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(400);
    expectClean(errors);
  });

  test('09 deep-link + reload preserves the checklist (session + flag intact)', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin');
    await expect(page.locator(CHECKLIST)).toBeVisible({ timeout: 15_000 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator(CHECKLIST), 'still there after reload').toBeVisible({ timeout: 15_000 });
    await expect(page).not.toHaveURL(/\/signin/);
  });

  test('10 full journey: land on hub → see checklist → follow next action → arrive on a real section', async ({
    page,
  }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin');
    await expect(page.locator(CHECKLIST)).toBeVisible({ timeout: 15_000 });
    const doneSteps = await page.locator('[data-testid^="onboarding-step-"].oc-step--done').count();
    expect(doneSteps, 'the org has real activation progress').toBeGreaterThanOrEqual(1);
    await page.locator('[data-testid="onboarding-next-cta"]').click();
    await expect(page).toHaveURL(/\/admin\/settings/, { timeout: 8_000 });
    await expect(page.getByRole('heading').first(), 'a real section rendered').toBeVisible();
    await snap(page, 'onboarding-10-journey');
    expectClean(errors);
  });
});
