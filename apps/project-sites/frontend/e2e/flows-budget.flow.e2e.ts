/**
 * flows-budget.flow.e2e.ts — Surface: the AI budget meter (feature
 * `token_burn_meter`) atop /admin/ai-endpoints (the AI Agents page).
 *
 * FINISHED this fire: the worker endpoint (`GET /api/usage/budget`) + flag were
 * live but had NO UI consumer. Built `<app-ai-budget-meter>` + wired it under the
 * ai-endpoints header.
 *
 * Ground truth (e2e-test-org, GET /api/usage/budget): plan "free", meter
 * {allowed:true, spentUsd:0, capUsd:5, remainingUsd:5, pct:0}.
 *
 * Real testids: ai-budget-meter, ai-budget-spent, ai-budget-cap,
 * ai-budget-remaining, ai-budget-bar, ai-budget-blocked, ai-budget-unlimited.
 *
 * Run: E2E_API_KEY=$(get-secret E2E_API_KEY) \
 *   npx playwright test --config=playwright.prod.config.ts flows-budget.flow --workers=3
 */
import { test, expect } from '@playwright/test';
import { hasKey, seedSession, gotoAdmin, attachConsole, expectClean, snap, apiFetch } from './_flow-helpers';

const METER = '[data-testid="ai-budget-meter"]';

test.describe('Full-flow · AI budget meter', () => {
  test.skip(!hasKey, 'E2E_API_KEY not set');
  test.describe.configure({ retries: 2 });
  test.use({ reducedMotion: 'reduce' });

  test('01 the AI budget meter renders atop /admin/ai-endpoints', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin/ai-endpoints');
    await expect(page.locator(METER), 'the budget meter renders').toBeVisible({ timeout: 20_000 });
    await expect(page.locator(METER)).toContainText(/ai budget/i);
    await snap(page, 'budget-01-meter');
    expectClean(errors);
  });

  test('02 the spend + cap render as USD amounts', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin/ai-endpoints');
    await expect(page.locator(METER)).toBeVisible({ timeout: 20_000 });
    const unlimited = page.locator('[data-testid="ai-budget-unlimited"]');
    if (await unlimited.count()) {
      await expect(unlimited).toBeVisible();
      return;
    }
    const spent = (await page.locator('[data-testid="ai-budget-spent"]').innerText()).trim();
    const cap = (await page.locator('[data-testid="ai-budget-cap"]').innerText()).trim();
    expect(spent, 'spend is a USD amount').toMatch(/^\$\d+\.\d{2}$/);
    expect(cap, 'cap is a USD amount').toMatch(/^\$\d+\.\d{2}$/);
  });

  test('03 ground-truth: the meter reconciles with /api/usage/budget', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin/ai-endpoints');
    await expect(page.locator(METER)).toBeVisible({ timeout: 20_000 });
    const api = await apiFetch<{ plan: string; meter: { spentUsd: number; capUsd: number; remainingUsd: number } }>(
      page,
      '/api/usage/budget',
    );
    expect(api.status).toBe(200);
    if (api.body.plan === 'unlimited' || api.body.meter.capUsd <= 0) {
      await expect(page.locator('[data-testid="ai-budget-unlimited"]')).toBeVisible();
      return;
    }
    const cap = (await page.locator('[data-testid="ai-budget-cap"]').innerText()).replace(/[^\d.]/g, '');
    expect(Number(cap), 'the cap reconciles with the store').toBe(api.body.meter.capUsd);
    const spent = (await page.locator('[data-testid="ai-budget-spent"]').innerText()).replace(/[^\d.]/g, '');
    expect(Number(spent), 'the spend reconciles with the store').toBe(api.body.meter.spentUsd);
  });

  test('04 the remaining budget renders', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin/ai-endpoints');
    await expect(page.locator(METER)).toBeVisible({ timeout: 20_000 });
    const remaining = page.locator('[data-testid="ai-budget-remaining"]');
    const unlimited = page.locator('[data-testid="ai-budget-unlimited"]');
    expect((await remaining.count()) + (await unlimited.count()), 'remaining-or-unlimited renders').toBeGreaterThan(0);
    if (await remaining.count()) {
      await expect(remaining).toContainText(/\$\d+\.\d{2} left/);
    }
  });

  test('05 the budget bar renders with a bounded width', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin/ai-endpoints');
    await expect(page.locator(METER)).toBeVisible({ timeout: 20_000 });
    const bar = page.locator('[data-testid="ai-budget-bar"]');
    if (await bar.count()) {
      const width = await bar.evaluate((el) => (el as HTMLElement).style.width);
      expect(width, 'bar width is a bounded percentage').toMatch(/%$/);
      expect(parseFloat(width), 'bar width ≤ 100%').toBeLessThanOrEqual(100);
    }
  });

  test('06 an in-budget org is NOT shown the blocked killswitch message', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin/ai-endpoints');
    await expect(page.locator(METER)).toBeVisible({ timeout: 20_000 });
    const api = await apiFetch<{ meter: { allowed: boolean } }>(page, '/api/usage/budget');
    // Reconcile the killswitch state: blocked message shows IFF the store says !allowed.
    if (api.body.meter?.allowed) {
      await expect(page.locator('[data-testid="ai-budget-blocked"]'), 'in-budget org has no block message').toHaveCount(0);
    } else {
      await expect(page.locator('[data-testid="ai-budget-blocked"]'), 'over-budget org sees the block message').toBeVisible();
    }
  });

  test('07 the budget surface is console-error-free', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin/ai-endpoints');
    await expect(page.locator(METER)).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(400);
    expectClean(errors);
  });

  test('08 full journey: open AI Agents → see the budget meter + the agents list → coherent + ground-truth', async ({
    page,
  }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin/ai-endpoints');
    await expect(page.locator(METER)).toBeVisible({ timeout: 20_000 });
    // The meter sits above the existing AI-endpoints list — not displacing it.
    await expect(page.locator('[data-testid="ai-endpoints-page"]'), 'the AI Agents page is intact').toBeVisible();
    const api = await apiFetch<{ meter: { capUsd: number } }>(page, '/api/usage/budget');
    expect(api.status).toBe(200);
    expect(typeof api.body.meter?.capUsd, 'the store returns a budget cap').toBe('number');
    await snap(page, 'budget-08-journey');
    expectClean(errors);
  });
});
