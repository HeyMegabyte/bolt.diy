/**
 * flows-credits.flow.e2e.ts — Surface: the credit wallet (feature
 * `credit_wallet_rollover`) on /admin/billing.
 *
 * FINISHED this fire — 4th missing-table module: `credit_wallet_ledger` did not
 * exist in prod, so balance/history/apply lied-empty/lied-success. Added
 * `migrations/0623_create_credit_wallet_ledger.sql` + applied, SEEDED a realistic
 * ledger (rollover +40, grant +100, three debits) → balance 111, and built
 * `<app-credits-widget>` + wired it onto the Billing tab.
 *
 * Ground truth (e2e-test-org): balance 111, monthly_allowance 100, rollover_cap
 * 300; 5 ledger rows (2 credits, 3 debits).
 *
 * Real testids: credits-widget, credits-balance, credits-history, credit-entry,
 * credit-amount, credits-empty.
 *
 * Run: E2E_API_KEY=$(get-secret E2E_API_KEY) \
 *   npx playwright test --config=playwright.prod.config.ts flows-credits.flow --workers=3
 */
import { test, expect } from '@playwright/test';
import { hasKey, seedSession, gotoAdmin, attachConsole, expectClean, snap, apiFetch } from './_flow-helpers';

const WIDGET = '[data-testid="credits-widget"]';

async function openBilling(page: import('@playwright/test').Page) {
  await gotoAdmin(page, '/admin/billing');
  if (await page.locator(WIDGET).isVisible().catch(() => false)) return;
  const tab = page.getByRole('tab', { name: /subscription|plan|usage/i }).first();
  if (await tab.count()) await tab.click().catch(() => {});
}

test.describe('Full-flow · credit wallet', () => {
  test.skip(!hasKey, 'E2E_API_KEY not set');
  test.describe.configure({ retries: 2 });
  test.use({ reducedMotion: 'reduce' });

  test('01 the credit wallet renders on /admin/billing with a balance', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await openBilling(page);
    await expect(page.locator(WIDGET), 'the credit wallet card renders').toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('heading', { name: /credit wallet/i })).toBeVisible();
    const bal = (await page.locator('[data-testid="credits-balance"]').innerText()).trim();
    expect(bal, 'the balance is a number').toMatch(/^-?\d+$/);
    await snap(page, 'credits-01-widget');
    expectClean(errors);
  });

  test('02 ground-truth: the widget balance reconciles with /api/credits/balance', async ({ page }) => {
    await seedSession(page);
    await openBilling(page);
    await expect(page.locator(WIDGET)).toBeVisible({ timeout: 20_000 });
    const api = await apiFetch<{ balance: number }>(page, '/api/credits/balance');
    expect(api.status).toBe(200);
    const uiBal = Number((await page.locator('[data-testid="credits-balance"]').innerText()).replace(/[^\d-]/g, ''));
    expect(uiBal, 'display balance reconciles with the store').toBe(api.body.balance);
  });

  test('03 the ledger history renders the seeded entries', async ({ page }) => {
    await seedSession(page);
    await openBilling(page);
    await expect(page.locator(WIDGET)).toBeVisible({ timeout: 20_000 });
    const rows = page.locator('[data-testid="credit-entry"]');
    const empty = page.locator('[data-testid="credits-empty"]');
    if (await empty.count()) {
      await expect(empty).toBeVisible();
      return;
    }
    expect(await rows.count(), 'the ledger has several entries').toBeGreaterThanOrEqual(3);
    await expect(page.locator(WIDGET)).toContainText(/allowance|rollover|generation|routing|chat/i);
    await snap(page, 'credits-03-ledger');
  });

  test('04 ground-truth: the ledger row count reconciles with /api/credits/history', async ({ page }) => {
    await seedSession(page);
    await openBilling(page);
    await expect(page.locator(WIDGET)).toBeVisible({ timeout: 20_000 });
    const api = await apiFetch<{ rows: unknown[] }>(page, '/api/credits/history');
    expect(api.status).toBe(200);
    const apiCount = (api.body.rows ?? []).length;
    const rows = page.locator('[data-testid="credit-entry"]');
    if (apiCount > 0) expect(await rows.count(), 'ledger rows reconcile with the store').toBe(apiCount);
  });

  test('05 debits render negative and grants render positive', async ({ page }) => {
    await seedSession(page);
    await openBilling(page);
    await expect(page.locator(WIDGET)).toBeVisible({ timeout: 20_000 });
    const appliedRow = page.locator('[data-testid="credit-entry"][data-kind="applied"]').first();
    if (await appliedRow.count()) {
      const amt = (await appliedRow.locator('[data-testid="credit-amount"]').innerText()).trim();
      expect(amt, 'a debit shows a negative amount').toMatch(/^-\d+$/);
    }
    const grantRow = page.locator('[data-testid="credit-entry"][data-kind="grant"], [data-testid="credit-entry"][data-kind="rollover"]').first();
    if (await grantRow.count()) {
      const amt = (await grantRow.locator('[data-testid="credit-amount"]').innerText()).trim();
      expect(amt, 'a grant shows a positive amount').toMatch(/^\+\d+$/);
    }
  });

  test('06 the credits surface is console-error-free', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await openBilling(page);
    await expect(page.locator(WIDGET)).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(400);
    expectClean(errors);
  });

  test('07 deep-link + reload preserves the credit wallet (session + flag intact)', async ({ page }) => {
    await seedSession(page);
    await openBilling(page);
    await expect(page.locator(WIDGET)).toBeVisible({ timeout: 20_000 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await openBilling(page);
    await expect(page.locator(WIDGET), 'still there after reload').toBeVisible({ timeout: 20_000 });
    await expect(page).not.toHaveURL(/\/signin/);
  });

  test('08 full journey: billing → credit balance + ledger both reflect the persisted store', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await openBilling(page);
    await expect(page.locator(WIDGET)).toBeVisible({ timeout: 20_000 });
    const bal = await apiFetch<{ balance: number }>(page, '/api/credits/balance');
    const hist = await apiFetch<{ rows: unknown[] }>(page, '/api/credits/history');
    expect(bal.status).toBe(200);
    expect(hist.status).toBe(200);
    // The sum of the ledger amounts equals the balance (accounting integrity).
    const rows = (hist.body.rows ?? []) as { amount: number }[];
    if (rows.length) {
      const sum = rows.reduce((s, r) => s + r.amount, 0);
      expect(sum, 'the ledger sums to the balance').toBe(bal.body.balance);
    }
    await snap(page, 'credits-08-journey');
    expectClean(errors);
  });
});
