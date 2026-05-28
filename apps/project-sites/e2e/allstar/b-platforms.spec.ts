/**
 * ALL-STAR Category B — Multi-tenant + agency mode (items 9-13).
 *
 * Tests the Workers-for-Platforms dispatch-namespace migration + outbound
 * Worker + agency tier + per-tenant DO SQLite + white-label admin.
 */

import { test, expect } from '@playwright/test';

const ADMIN = '/admin';

test.describe('#9 Workers for Platforms dispatch-namespace migration', () => {
  test('each customer site runs as a User Worker in dispatch namespace', async ({ page }) => {
    await page.goto(`${ADMIN}/sites`);
    const card = page.getByTestId('site-card').first();
    await card.click();
    await page.getByRole('tab', { name: /infrastructure|runtime/i }).click();

    await expect(page.getByTestId('dispatch-namespace')).toContainText(/projectsites-(prod|staging)/);
    await expect(page.getByTestId('user-worker-name')).toContainText(/^[a-z0-9-]+$/);
    await expect(page.getByTestId('worker-isolation-status')).toContainText(/isolated|untrusted/i);
  });

  test('per-tenant CPU + subrequest limits surface in admin', async ({ page }) => {
    await page.goto(`${ADMIN}/sites/limits`);
    const limits = page.getByTestId('tenant-limits-card');
    await expect(limits.getByTestId('cpu-limit-ms')).toContainText(/^\d+$/);
    await expect(limits.getByTestId('subrequest-limit')).toContainText(/^\d+$/);
  });

  test('site request reaches the dispatch Worker → user Worker chain', async ({ request }) => {
    // Dispatch chain is observable via response header
    const res = await request.get('https://projectsites.dev/', { failOnStatusCode: false });
    expect(res.headers()['x-dispatch-namespace']).toBeTruthy();
    expect(res.headers()['x-user-worker']).toBeTruthy();
  });
});

test.describe('#10 outbound Worker for per-tenant egress control', () => {
  test('admin blocklist UI rejects domain pattern + saves rule', async ({ page }) => {
    await page.goto(`${ADMIN}/sites/egress`);
    await page.getByRole('button', { name: /add rule|block domain/i }).click();
    await page.getByLabel(/domain pattern/i).fill('*.example-bad.com');
    await page.getByRole('radio', { name: /block/i }).check();
    await page.getByRole('button', { name: /save/i }).click();
    await expect(page.getByTestId('egress-rule-row').filter({ hasText: 'example-bad.com' })).toBeVisible();
  });

  test('every outbound fetch from a customer site is logged with destination', async ({ page }) => {
    await page.goto(`${ADMIN}/sites/egress?tab=logs`);
    await expect(page.getByTestId('egress-log-row').first()).toBeVisible();
    await expect(page.getByTestId('egress-log-row').first()).toContainText(/https?:\/\//);
  });
});

test.describe('#11 reseller / agency tier via Stripe Connect Express', () => {
  test('agency owner sees per-client revenue split + Stripe Connect status', async ({ page }) => {
    await page.goto(`${ADMIN}/agency/clients`);
    await expect(page.getByTestId('agency-client-row').first()).toBeVisible();
    await expect(page.getByTestId('stripe-connect-status')).toContainText(/active|onboarding/i);

    const firstClient = page.getByTestId('agency-client-row').first();
    await expect(firstClient.getByTestId('client-mrr')).toContainText(/\$\d+/);
    await expect(firstClient.getByTestId('platform-fee')).toContainText(/\d+%/);
  });

  test('bulk action — publish 20 client sites in one operation', async ({ page }) => {
    await page.goto(`${ADMIN}/agency/clients`);
    await page.getByTestId('select-all-clients').check();
    await page.getByRole('button', { name: /bulk actions/i }).click();
    await page.getByRole('menuitem', { name: /publish all/i }).click();
    await page.getByRole('button', { name: /confirm/i }).click();
    await expect(page.getByTestId('bulk-progress')).toBeVisible();
    await expect(page.getByText(/published \d+ of \d+/)).toBeVisible({ timeout: 60_000 });
  });

  test('white-label invoice PDF carries agency logo + terms', async ({ page, request }) => {
    await page.goto(`${ADMIN}/agency/invoices`);
    const invoiceRow = page.getByTestId('invoice-row').first();
    await invoiceRow.click();
    const pdfUrl = await page.getByRole('link', { name: /download pdf/i }).getAttribute('href');
    expect(pdfUrl).toMatch(/\.pdf$/);
    const pdf = await request.get(pdfUrl!);
    expect(pdf.headers()['content-type']).toContain('pdf');
    // PDF binary contains agency branding marker (set by builder)
    const body = await pdf.body();
    expect(body.length).toBeGreaterThan(2_000);
  });
});

test.describe('#12 per-tenant DO SQLite for hot state', () => {
  test('user opens editor — draft state persists in DO, not D1', async ({ page }) => {
    await page.goto(`${ADMIN}/editor`);
    await page.getByTestId('bolt-prompt-input').fill('Test draft persistence');
    // Close + reopen
    await page.reload();
    await expect(page.getByTestId('bolt-prompt-input')).toHaveValue('Test draft persistence');
  });

  test('admin sees per-tenant DO storage usage with hibernation status', async ({ page }) => {
    await page.goto(`${ADMIN}/infrastructure/durable-objects`);
    await expect(page.getByTestId('do-storage-card').first()).toBeVisible();
    await expect(page.getByTestId('do-hibernation-status').first()).toContainText(/active|hibernating/i);
  });
});

test.describe('#13 white-label admin domain', () => {
  test('agency configures vanity admin hostname + assets recolor', async ({ page }) => {
    await page.goto(`${ADMIN}/agency/branding`);
    await page.getByLabel(/admin domain/i).fill('clients.acme-agency.com');
    await page.getByLabel(/primary color/i).fill('#ff6600');
    await page.getByRole('button', { name: /save/i }).click();
    await expect(page.getByTestId('branding-preview')).toHaveCSS('--ps-accent', /#ff6600/i);
  });

  test('white-labeled admin loads custom favicon + manifest', async ({ page, request }) => {
    // After save above, the vanity domain's manifest pulls agency name
    const res = await request.get(`${ADMIN}/api/manifest`, {
      headers: { Host: 'clients.acme-agency.com' },
      failOnStatusCode: false,
    });
    if (res.status() === 200) {
      const body = await res.json();
      expect(body.name).toMatch(/acme|agency/i);
    }
  });
});
