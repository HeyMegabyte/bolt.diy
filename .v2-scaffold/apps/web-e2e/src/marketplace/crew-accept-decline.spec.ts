/**
 * crew-accept-decline.spec.ts — TDD RED phase
 *
 * Crew online toggle → job appears in feed → accept button fires →
 * auto-decline timer counts down → auto-declines on expire.
 */

import { test, expect } from '../_fixtures/auth.js';

const TEST_JOB_ID = 'job-offer-001';
const AUTO_DECLINE_MS = 5_000; // test-mode short timer

test.describe('crew accept / decline flow', () => {
  test.beforeEach(async ({ authedPage }) => {
    await authedPage.route('**/api/crew/status**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ online: true }),
      });
    });

    await authedPage.route(`**/api/jobs/${TEST_JOB_ID}/accept**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ accepted: true }),
      });
    });

    await authedPage.route(`**/api/jobs/${TEST_JOB_ID}/decline**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ declined: true }),
      });
    });

    await authedPage.goto('/');
    const crewPortalLink = authedPage
      .getByRole('link', { name: /crew portal|my jobs/i })
      .or(authedPage.getByTestId('nav-crew-portal'));
    await crewPortalLink.click();
    await expect(authedPage).toHaveURL(/\/dashboard/);
  });

  test('crew online toggle makes job appear in feed', async ({ authedPage }) => {
    const onlineToggle = authedPage
      .getByRole('checkbox', { name: /online|available/i })
      .or(authedPage.getByTestId('crew-online-toggle'));
    await expect(onlineToggle).toBeVisible({ timeout: 8_000 });

    // Go offline first
    if (await onlineToggle.isChecked()) {
      await onlineToggle.uncheck();
    }

    // Seed a new job offer from the server perspective
    await authedPage.route('**/api/jobs/feed**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: TEST_JOB_ID,
            title: 'Delivery Test Job',
            offeredAt: Date.now(),
            autoDeclineAt: Date.now() + AUTO_DECLINE_MS,
          },
        ]),
      });
    });

    // Toggle online
    await onlineToggle.check();

    // Job should appear in the feed
    await expect(
      authedPage.getByTestId(`job-offer-${TEST_JOB_ID}`).or(authedPage.getByText('Delivery Test Job')),
    ).toBeVisible({ timeout: 8_000 });
  });

  test('accept button fires and job is confirmed', async ({ authedPage }) => {
    // Pre-seed feed
    await authedPage.route('**/api/jobs/feed**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: TEST_JOB_ID,
            title: 'Delivery Test Job',
            offeredAt: Date.now(),
            autoDeclineAt: Date.now() + AUTO_DECLINE_MS,
          },
        ]),
      });
    });

    const onlineToggle = authedPage
      .getByRole('checkbox', { name: /online|available/i })
      .or(authedPage.getByTestId('crew-online-toggle'));
    await onlineToggle.check();

    const acceptBtn = authedPage
      .getByRole('button', { name: /accept/i })
      .or(authedPage.getByTestId(`job-accept-${TEST_JOB_ID}`));
    await expect(acceptBtn).toBeVisible({ timeout: 8_000 });
    await acceptBtn.click();

    await expect(
      authedPage.getByRole('status').or(authedPage.getByTestId('toast-success')),
    ).toBeVisible({ timeout: 5_000 });
  });

  test('auto-decline timer counts down and auto-declines on expire', async ({ authedPage }) => {
    // Use an extremely short auto-decline window for test speed
    await authedPage.route('**/api/jobs/feed**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: TEST_JOB_ID,
            title: 'Delivery Test Job',
            offeredAt: Date.now(),
            autoDeclineAt: Date.now() + 3_000, // 3-second timer for tests
          },
        ]),
      });
    });

    const onlineToggle = authedPage
      .getByRole('checkbox', { name: /online|available/i })
      .or(authedPage.getByTestId('crew-online-toggle'));
    await onlineToggle.check();

    // Countdown should be visible
    const countdown = authedPage
      .getByTestId('job-auto-decline-timer')
      .or(authedPage.getByRole('timer'));
    await expect(countdown).toBeVisible({ timeout: 8_000 });

    // Wait for auto-decline to fire
    await authedPage.waitForTimeout(4_000);

    // Job offer should no longer appear
    await expect(
      authedPage.getByTestId(`job-offer-${TEST_JOB_ID}`),
    ).not.toBeVisible({ timeout: 5_000 });
  });
});
