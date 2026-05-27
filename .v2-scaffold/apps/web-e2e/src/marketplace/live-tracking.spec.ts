/**
 * live-tracking.spec.ts — TDD RED phase
 *
 * /dashboard/jobs/:id must render:
 * - Exactly ONE <google-map> element (no duplicate from /work/dashboard)
 * - ETA countdown updates every second
 * - WebSocket chat message renders
 */

import { test, expect } from '../_fixtures/auth.js';

const TEST_JOB_ID = 'job-live-001';

test.describe('live tracking', () => {
  test.beforeEach(async ({ authedPage }) => {
    // Seed job data
    await authedPage.route(`**/api/jobs/${TEST_JOB_ID}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: TEST_JOB_ID,
          status: 'in_progress',
          crewLocation: { lat: 40.7128, lng: -74.006 },
          etaSeconds: 120,
          messages: [],
        }),
      });
    });

    await authedPage.goto('/');
    const jobsLink = authedPage
      .getByRole('link', { name: /jobs/i })
      .or(authedPage.getByTestId('nav-jobs'));
    await jobsLink.click();
    await expect(authedPage).toHaveURL(/\/jobs/);
  });

  test('renders exactly ONE <google-map> element', async ({ authedPage }) => {
    await authedPage.goto(`/dashboard/jobs/${TEST_JOB_ID}`);

    // Wait for the map to mount
    const mapElements = authedPage.locator('google-map, [data-testid="job-map"]');
    await expect(mapElements).toHaveCount(1, { timeout: 10_000 });
  });

  test('ETA countdown updates after 1 second', async ({ authedPage }) => {
    await authedPage.goto(`/dashboard/jobs/${TEST_JOB_ID}`);

    const etaDisplay = authedPage
      .getByTestId('job-eta')
      .or(authedPage.getByRole('timer'))
      .or(authedPage.getByText(/eta|arrives in/i));
    await expect(etaDisplay).toBeVisible({ timeout: 8_000 });

    // Capture initial text
    const initialText = await etaDisplay.textContent();

    // Wait 1.5 seconds for at least one tick
    await authedPage.waitForTimeout(1_500);

    const updatedText = await etaDisplay.textContent();
    // Text should have changed (countdown decremented)
    expect(updatedText).not.toBe(initialText);
  });

  test('WebSocket chat message renders', async ({ authedPage }) => {
    // Inject a WebSocket message after the page loads
    await authedPage.goto(`/dashboard/jobs/${TEST_JOB_ID}`);

    const chatPanel = authedPage.getByTestId('job-chat').or(authedPage.getByRole('log'));
    await expect(chatPanel).toBeVisible({ timeout: 8_000 });

    // Simulate a WS message via page evaluate
    await authedPage.evaluate(() => {
      // Dispatch a custom event that the Angular component listens to for WS messages
      window.dispatchEvent(
        new CustomEvent('ws:message', {
          detail: {
            type: 'chat',
            jobId: 'job-live-001',
            message: 'Crew is 5 minutes away',
            sender: 'Crew',
            timestamp: Date.now(),
          },
        }),
      );
    });

    await expect(
      chatPanel.getByText('Crew is 5 minutes away'),
    ).toBeVisible({ timeout: 5_000 });
  });
});
