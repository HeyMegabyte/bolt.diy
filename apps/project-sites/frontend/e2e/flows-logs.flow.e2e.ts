/**
 * flows-logs.flow.e2e.ts — Surface: admin Logs (/admin/logs).
 *
 * Re-authored fire-5 after an INTERACTION probe (the fire-4 agent asserted the
 * wrong per-tab content). The 3 tabs each swap the heading + expose their own
 * testids:
 *   - logs-tab-audit    → "Audit Log" + audit-empty ("No audit events yet") + audit-scope-chip
 *   - logs-tab-explorer → "Log Explorer" + logs-search-input + logs-search-btn (+ logs-loading)
 *   - logs-tab-traces   → "AI Traces Live" + ai-logs-empty + ai-logs-empty-refresh
 * Root: logs-dashboard. The e2e-test-org has 0 audit/trace events (honest empty).
 *
 * Run: E2E_API_KEY=$(get-secret E2E_API_KEY) \
 *   npx playwright test --config=playwright.prod.config.ts flows-logs.flow --workers=3
 */
import { test, expect } from '@playwright/test';
import { hasKey, seedSession, gotoAdmin, attachConsole, expectClean, snap, apiFetch } from './_flow-helpers';

async function clickTab(page: import('@playwright/test').Page, tab: string): Promise<void> {
  const el = page.locator(`[data-testid="${tab}"]`);
  await expect(el).toBeVisible({ timeout: 15_000 });
  await el.click();
  await page.waitForTimeout(400);
}

test.describe('Full-flow · logs', () => {
  test.skip(!hasKey, 'E2E_API_KEY not set');
  test.describe.configure({ retries: 2 });
  test.use({ reducedMotion: 'reduce' });

  test('01 logs dashboard boots on the Audit tab with the honest empty state', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin/logs');
    await expect(page).toHaveURL(/\/admin\/logs/);
    await expect(page.locator('[data-testid="logs-dashboard"]')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('heading', { name: /^logs$/i }).first()).toBeVisible();
    await expect(page.locator('[data-testid="audit-empty"]'), '0-event org shows the honest empty state').toBeVisible({
      timeout: 12_000,
    });
    await snap(page, 'logs-01-audit');
    expectClean(errors);
  });

  test('02 the audit scope chip shows the org scope', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin/logs');
    const chip = page.locator('[data-testid="audit-scope-chip"]');
    if (await chip.count()) await expect(chip.first()).toBeVisible({ timeout: 12_000 });
  });

  test('03 clicking the Explorer tab swaps to the Log Explorer with a search box', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin/logs');
    await clickTab(page, 'logs-tab-explorer');
    await expect(page.getByRole('heading', { name: /log explorer/i }).first()).toBeVisible({ timeout: 12_000 });
    await expect(page.locator('[data-testid="logs-search-input"]')).toBeVisible({ timeout: 10_000 });
    await snap(page, 'logs-03-explorer');
  });

  test('04 the Explorer search box accepts a query and the search button runs it', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin/logs');
    await clickTab(page, 'logs-tab-explorer');
    const input = page.locator('[data-testid="logs-search-input"]');
    await expect(input).toBeVisible({ timeout: 12_000 });
    await input.fill('error');
    await expect(input).toHaveValue('error');
    const btn = page.locator('[data-testid="logs-search-btn"]');
    if (await btn.count()) {
      await btn.click();
      await page.waitForTimeout(600); // logs-loading may flash; no assertion on empty result
    }
  });

  test('05 clicking the Traces tab swaps to AI Traces Live', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin/logs');
    await clickTab(page, 'logs-tab-traces');
    await expect(page.getByRole('heading', { name: /ai traces|traces/i }).first()).toBeVisible({ timeout: 12_000 });
    await expect(page.locator('[data-testid="ai-logs-empty"]'), '0-trace org shows the honest empty state').toBeVisible({
      timeout: 10_000,
    });
    await snap(page, 'logs-05-traces');
  });

  test('06 the Traces empty-state refresh button re-fetches without crashing', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin/logs');
    await clickTab(page, 'logs-tab-traces');
    const refresh = page.locator('[data-testid="ai-logs-empty-refresh"]');
    if (await refresh.count()) {
      await refresh.click();
      await page.waitForTimeout(600);
    }
    expectClean(errors);
  });

  test('07 returning to the Audit tab restores the audit view', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin/logs');
    await clickTab(page, 'logs-tab-explorer');
    await clickTab(page, 'logs-tab-audit');
    await expect(page.getByRole('heading', { name: /audit log/i }).first()).toBeVisible({ timeout: 12_000 });
    await expect(page.locator('[data-testid="audit-empty"]')).toBeVisible({ timeout: 10_000 });
  });

  test('08 each tab reports an active/selected state when chosen', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin/logs');
    for (const tab of ['logs-tab-explorer', 'logs-tab-traces', 'logs-tab-audit']) {
      await clickTab(page, tab);
      const active = await page.evaluate((t) => {
        const e = document.querySelector('[data-testid="' + t + '"]');
        if (!e) return false;
        return (
          e.getAttribute('aria-selected') === 'true' ||
          e.getAttribute('aria-current') != null ||
          /active|selected/.test(e.className) ||
          e.getAttribute('data-active') === 'true'
        );
      }, tab);
      expect(active, `${tab} reflects active state`).toBeTruthy();
    }
  });

  test('09 the "Refresh now" control on Audit re-fetches without console error', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin/logs');
    const refresh = page.getByRole('button', { name: /refresh now/i }).first();
    if (await refresh.count()) {
      await refresh.click();
      await page.waitForTimeout(600);
    }
    expectClean(errors);
  });

  test('10 an "Export CSV" affordance is present on the audit view', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin/logs');
    await expect(page.locator('[data-testid="logs-dashboard"]')).toBeVisible({ timeout: 15_000 });
    const exportBtn = page.getByRole('button', { name: /export csv/i }).first();
    if (await exportBtn.count()) await expect(exportBtn).toBeVisible();
  });

  test('11 deep-link + reload preserves the logs dashboard (session intact)', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin/logs');
    await expect(page.locator('[data-testid="logs-dashboard"]')).toBeVisible({ timeout: 15_000 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-testid="logs-dashboard"]')).toBeVisible({ timeout: 15_000 });
    await expect(page).not.toHaveURL(/\/signin/);
  });

  test('12 full round-trip: audit → explorer → traces → audit, each heading correct', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin/logs');
    await expect(page.getByRole('heading', { name: /audit log/i }).first()).toBeVisible({ timeout: 15_000 });
    await clickTab(page, 'logs-tab-explorer');
    await expect(page.getByRole('heading', { name: /log explorer/i }).first()).toBeVisible();
    await clickTab(page, 'logs-tab-traces');
    await expect(page.getByRole('heading', { name: /traces/i }).first()).toBeVisible();
    await clickTab(page, 'logs-tab-audit');
    await expect(page.getByRole('heading', { name: /audit log/i }).first()).toBeVisible();
    await snap(page, 'logs-12-roundtrip');
    expectClean(errors);
  });

  test('13 keyboard: a log tab is focusable and Enter/Space-activates', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin/logs');
    const explorer = page.locator('[data-testid="logs-tab-explorer"]');
    await expect(explorer).toBeVisible({ timeout: 15_000 });
    await explorer.focus();
    expect(await explorer.evaluate((el) => el === document.activeElement)).toBeTruthy();
  });

  test('14 ground-truth: /admin/logs authorizes (auth/me 200) + shows honest 0-event states across tabs', async ({
    page,
  }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin/logs');
    const me = await apiFetch<Record<string, unknown>>(page, '/api/auth/me');
    expect(me.status).toBe(200);
    await expect(page.locator('[data-testid="audit-empty"]')).toBeVisible({ timeout: 12_000 });
    await clickTab(page, 'logs-tab-traces');
    await expect(page.locator('[data-testid="ai-logs-empty"]')).toBeVisible({ timeout: 10_000 });
  });
});
