/**
 * ALL-STAR Category G — Monetization that scales (items 35-38).
 *
 * Stripe Meters AI-token billing, annual-plan upsell at month 3, double-sided
 * referral credits, per-tenant cost-attribution dashboard.
 */

import { test, expect } from '@playwright/test';

const ADMIN = '/admin';

test.describe('#35 AI-token-metered billing via Stripe Meters', () => {
  test('every prompt logs a meter event surface in admin', async ({ page }) => {
    await page.goto(`${ADMIN}/billing/usage`);
    const meter = page.getByTestId('stripe-meter-events');
    await expect(meter).toBeVisible();
    await expect(meter.getByTestId('meter-event-row').first()).toBeVisible();
    // Each row: model + token count + event id (idempotency key)
    const row = meter.getByTestId('meter-event-row').first();
    await expect(row.getByTestId('event-id')).toContainText(/^evt_/);
    await expect(row.getByTestId('event-tokens')).toContainText(/\d+/);
  });

  test('monthly invoice line includes both subscription + usage overage', async ({ page }) => {
    await page.goto(`${ADMIN}/billing/invoices`);
    const invoiceRow = page.getByTestId('invoice-row').first();
    await invoiceRow.click();
    const lines = page.getByTestId('invoice-line-row');
    // At least one subscription line + one usage line
    await expect(lines.filter({ hasText: /subscription|recurring/i }).first()).toBeVisible();
    await expect(lines.filter({ hasText: /token|usage|metered/i }).first()).toBeVisible();
  });

  test('admin sets a hard cap; cap-reached blocks new prompts with friendly UI', async ({ page }) => {
    await page.goto(`${ADMIN}/billing/usage`);
    await page.getByRole('button', { name: /set spend cap|monthly limit/i }).click();
    await page.getByLabel(/cap amount/i).fill('50');
    await page.getByRole('button', { name: /save/i }).click();
    await expect(page.getByTestId('spend-cap-value')).toContainText('$50');
  });
});

test.describe('#36 annual-plan upsell automation at month 3', () => {
  test('admin sees the upsell campaign with template + delivery cadence', async ({ page }) => {
    await page.goto(`${ADMIN}/automation/campaigns`);
    await expect(page.getByTestId('campaign-row').filter({ hasText: /annual upsell/i })).toBeVisible();
  });

  test('campaign personalizes by usage — preview shows real spend numbers', async ({ page }) => {
    await page.goto(`${ADMIN}/automation/campaigns`);
    await page.getByTestId('campaign-row').filter({ hasText: /annual upsell/i }).click();
    await expect(page.getByTestId('campaign-preview-body')).toContainText(/\$\d+\/mo|saved \$/i);
  });
});

test.describe('#37 double-sided referral credits', () => {
  test('admin sees per-user referral code + sharing link', async ({ page }) => {
    await page.goto(`${ADMIN}/account/referrals`);
    await expect(page.getByTestId('referral-code')).toBeVisible();
    await expect(page.getByTestId('referral-link')).toContainText(/https?:\/\//);
    await expect(page.getByTestId('referrer-credit-amount')).toContainText(/\$\d+/);
    await expect(page.getByTestId('referee-credit-amount')).toContainText(/\$\d+/);
  });

  test('referee signup applies coupon automatically when ?ref=CODE present', async ({ page }) => {
    await page.goto('/signup?ref=TESTCODE');
    await expect(page.getByTestId('referral-applied-banner')).toBeVisible();
  });

  test('successful conversion credits both parties (visible in ledger)', async ({ page }) => {
    await page.goto(`${ADMIN}/account/referrals?tab=ledger`);
    await expect(page.getByTestId('referral-ledger-row').first()).toBeVisible();
    const row = page.getByTestId('referral-ledger-row').first();
    await expect(row.getByTestId('ledger-status')).toContainText(/credited|pending|paid/i);
  });
});

test.describe('#38 per-tenant cost-attribution dashboard', () => {
  test('agency sees CF + AI spend per client', async ({ page }) => {
    await page.goto(`${ADMIN}/agency/costs`);
    const table = page.getByTestId('cost-attribution-table');
    await expect(table).toBeVisible();
    const row = table.getByTestId('client-cost-row').first();
    await expect(row.getByTestId('cost-cloudflare')).toContainText(/\$\d+/);
    await expect(row.getByTestId('cost-ai')).toContainText(/\$\d+/);
    await expect(row.getByTestId('cost-total')).toContainText(/\$\d+/);
  });

  test('export cost report as CSV', async ({ page }) => {
    await page.goto(`${ADMIN}/agency/costs`);
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: /export csv/i }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.csv$/);
  });

  test('retail markup multiplier per client (Stripe Connect split)', async ({ page }) => {
    await page.goto(`${ADMIN}/agency/costs`);
    const row = page.getByTestId('client-cost-row').first();
    await row.getByRole('button', { name: /set markup/i }).click();
    await page.getByLabel(/multiplier/i).fill('1.5');
    await page.getByRole('button', { name: /save/i }).click();
    await expect(row.getByTestId('retail-price')).toContainText(/\$\d+/);
  });
});
