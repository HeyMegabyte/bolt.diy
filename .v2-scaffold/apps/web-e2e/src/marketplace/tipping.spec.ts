/**
 * tipping.spec.ts — TDD RED phase
 *
 * Post-job tip dialog with $5/$10/$20 presets + custom amount.
 * Submitting tip writes audit log + POSTs to /api/jobs/:id/tip.
 */

import { test, expect } from '../_fixtures/auth.js';

const TEST_JOB_ID = 'job-complete-001';

test.describe('post-job tipping', () => {
  test.beforeEach(async ({ authedPage }) => {
    await authedPage.route(`**/api/jobs/${TEST_JOB_ID}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: TEST_JOB_ID,
          status: 'completed',
          crewName: 'Test Crew Member',
          completedAt: new Date().toISOString(),
        }),
      });
    });

    await authedPage.goto('/');
    const jobsLink = authedPage
      .getByRole('link', { name: /jobs|bookings/i })
      .or(authedPage.getByTestId('nav-jobs'));
    await jobsLink.click();
    await expect(authedPage).toHaveURL(/\/(jobs|bookings)/);
  });

  test('tip dialog shows $5, $10, $20 preset buttons', async ({ authedPage }) => {
    await authedPage.goto(`/dashboard/jobs/${TEST_JOB_ID}`);

    const tipBtn = authedPage
      .getByRole('button', { name: /tip|leave a tip/i })
      .or(authedPage.getByTestId('job-tip-btn'));
    await expect(tipBtn).toBeVisible({ timeout: 8_000 });
    await tipBtn.click();

    const dialog = authedPage.getByRole('dialog').or(authedPage.getByTestId('tip-dialog'));
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    for (const amount of ['$5', '$10', '$20']) {
      await expect(
        dialog.getByRole('button', { name: amount }).or(dialog.getByTestId(`tip-preset-${amount.replace('$', '')}`)),
      ).toBeVisible();
    }
  });

  test('preset $10 tip submits and POSTs to API', async ({ authedPage }) => {
    let tipPostBody: unknown;
    await authedPage.route(`**/api/jobs/${TEST_JOB_ID}/tip**`, async (route) => {
      tipPostBody = await route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      });
    });

    await authedPage.goto(`/dashboard/jobs/${TEST_JOB_ID}`);

    const tipBtn = authedPage
      .getByRole('button', { name: /tip|leave a tip/i })
      .or(authedPage.getByTestId('job-tip-btn'));
    await tipBtn.click();

    const dialog = authedPage.getByRole('dialog').or(authedPage.getByTestId('tip-dialog'));
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // Click $10 preset
    const tenDollarBtn = dialog
      .getByRole('button', { name: '$10' })
      .or(dialog.getByTestId('tip-preset-10'));
    await tenDollarBtn.click();

    // Confirm / submit
    const confirmBtn = dialog
      .getByRole('button', { name: /confirm|send tip|pay/i })
      .or(dialog.getByTestId('tip-confirm-btn'));
    await confirmBtn.click();

    // Success
    await expect(
      authedPage.getByRole('status').or(authedPage.getByTestId('toast-success')),
    ).toBeVisible({ timeout: 5_000 });

    // API was called with correct amount
    expect(tipPostBody).toMatchObject({ amount: 1000 }); // cents
  });

  test('custom tip amount submits correctly', async ({ authedPage }) => {
    let tipPostBody: unknown;
    await authedPage.route(`**/api/jobs/${TEST_JOB_ID}/tip**`, async (route) => {
      tipPostBody = await route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      });
    });

    await authedPage.goto(`/dashboard/jobs/${TEST_JOB_ID}`);

    const tipBtn = authedPage
      .getByRole('button', { name: /tip|leave a tip/i })
      .or(authedPage.getByTestId('job-tip-btn'));
    await tipBtn.click();

    const dialog = authedPage.getByRole('dialog').or(authedPage.getByTestId('tip-dialog'));
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // Enter custom amount
    const customInput = dialog
      .getByRole('spinbutton', { name: /custom|other/i })
      .or(dialog.getByTestId('tip-custom-input'));
    await expect(customInput).toBeVisible();
    await customInput.fill('35');

    const confirmBtn = dialog
      .getByRole('button', { name: /confirm|send tip|pay/i })
      .or(dialog.getByTestId('tip-confirm-btn'));
    await confirmBtn.click();

    await expect(
      authedPage.getByRole('status').or(authedPage.getByTestId('toast-success')),
    ).toBeVisible({ timeout: 5_000 });

    expect(tipPostBody).toMatchObject({ amount: 3500 }); // $35 in cents
  });

  test('tip submission writes audit log entry', async ({ authedPage }) => {
    let auditLogCalled = false;
    await authedPage.route('**/api/audit**', async (route) => {
      auditLogCalled = true;
      await route.continue();
    });
    await authedPage.route(`**/api/jobs/${TEST_JOB_ID}/tip**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      });
    });

    await authedPage.goto(`/dashboard/jobs/${TEST_JOB_ID}`);
    const tipBtn = authedPage.getByTestId('job-tip-btn').or(
      authedPage.getByRole('button', { name: /tip/i }),
    );
    await tipBtn.click();

    const dialog = authedPage.getByRole('dialog');
    await dialog.getByRole('button', { name: '$5' }).or(dialog.getByTestId('tip-preset-5')).click();
    const confirmBtn = dialog.getByRole('button', { name: /confirm|send tip|pay/i }).or(
      dialog.getByTestId('tip-confirm-btn'),
    );
    await confirmBtn.click();

    await authedPage.waitForTimeout(500);
    expect(auditLogCalled).toBe(true);
  });
});
