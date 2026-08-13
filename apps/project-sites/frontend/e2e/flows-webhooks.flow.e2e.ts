/**
 * flows-webhooks.flow.e2e.ts — Full-flow E2E: Outbound Webhooks surface
 * Path: Settings › Webhooks (deep-linked at /admin/settings#webhooks)
 *
 * NON-GOALS: never actually submit / create a webhook endpoint.
 * Auth: e2e-test-org owner (E2E_API_KEY). Org starts with 0 webhooks (honest empty).
 *
 * Run: E2E_API_KEY=$(get-secret E2E_API_KEY) \
 *   npx playwright test --config=playwright.prod.config.ts flows-webhooks.flow
 */

import { test, expect } from '@playwright/test';
import {
  hasKey,
  seedSession,
  gotoAdmin,
  attachConsole,
  expectClean,
  snap,
} from './_flow-helpers';

test.describe('Full-flow · webhooks', () => {
  test.skip(!hasKey, 'E2E_API_KEY not set — skipping authed webhook flows');
  test.describe.configure({ retries: 2 });
  // Reduced-motion disables the Angular View-Transition pointer overlay that
  // otherwise intercepts nav clicks mid-transition — removes concurrency flake
  // AND makes visual snaps deterministic.
  test.use({ reducedMotion: 'reduce' });

  // ── Test 1: Panel root renders with correct heading ────────────────────────

  test('01 settings-webhooks-panel renders with "Outbound Webhooks" heading', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin/settings#webhooks');
    const panel = page.getByTestId('settings-webhooks-panel');
    await expect(panel).toBeVisible({ timeout: 15_000 });
    await expect(
      panel.getByRole('heading', { name: /outbound webhooks/i }),
    ).toBeVisible();
    await snap(page, '01-webhooks-panel-heading');
    expectClean(errors);
  });

  // ── Test 2: Honest empty state ─────────────────────────────────────────────

  test('02 honest empty state — "No webhook endpoints" shown for org with 0 webhooks', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin/settings#webhooks');
    const panel = page.getByTestId('settings-webhooks-panel');
    await expect(panel).toBeVisible({ timeout: 15_000 });
    // Use guards — the component may render empty-state or empty-title or raw text
    const emptyState = panel.getByTestId('empty-state');
    if (await emptyState.count()) {
      await expect(emptyState).toBeVisible();
      const emptyTitle = panel.getByTestId('empty-title');
      if (await emptyTitle.count()) {
        await expect(emptyTitle).toContainText(/no webhook endpoints/i);
      } else {
        await expect(panel.getByText(/no webhook endpoints/i)).toBeVisible();
      }
    } else {
      await expect(panel.getByText(/no webhook endpoints/i)).toBeVisible();
    }
    await snap(page, '02-webhooks-empty-state');
    expectClean(errors);
  });

  // ── Test 3: URL input accepts and retains a valid https URL ────────────────

  test('03 webhooks-url input accepts and retains "https://example.com/hook"', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin/settings#webhooks');
    const panel = page.getByTestId('settings-webhooks-panel');
    await expect(panel).toBeVisible({ timeout: 15_000 });
    const urlInput = panel.getByTestId('webhooks-url');
    await expect(urlInput).toBeVisible();
    await urlInput.fill('https://example.com/hook');
    await expect(urlInput).toHaveValue('https://example.com/hook');
    await snap(page, '03-webhooks-url-filled');
    expectClean(errors);
  });

  // ── Test 4: site.published checkbox toggles ────────────────────────────────

  test('04 webhooks-event-site.published checkbox: check → assert checked → uncheck', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin/settings#webhooks');
    const panel = page.getByTestId('settings-webhooks-panel');
    await expect(panel).toBeVisible({ timeout: 15_000 });
    const checkbox = panel.getByTestId('webhooks-event-site.published');
    await expect(checkbox).toBeVisible();
    // Ensure unchecked state first
    if (await checkbox.isChecked()) { await checkbox.uncheck(); }
    await checkbox.check();
    await expect(checkbox).toBeChecked();
    await snap(page, '04-webhooks-event-site-published-checked');
    await checkbox.uncheck();
    await expect(checkbox).not.toBeChecked();
    expectClean(errors);
  });

  // ── Test 5: form.submitted checkbox toggles ────────────────────────────────

  test('05 webhooks-event-form.submitted checkbox: check → assert checked → uncheck', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin/settings#webhooks');
    const panel = page.getByTestId('settings-webhooks-panel');
    await expect(panel).toBeVisible({ timeout: 15_000 });
    const checkbox = panel.getByTestId('webhooks-event-form.submitted');
    await expect(checkbox).toBeVisible();
    if (await checkbox.isChecked()) { await checkbox.uncheck(); }
    await checkbox.check();
    await expect(checkbox).toBeChecked();
    await snap(page, '05-webhooks-event-form-submitted-checked');
    await checkbox.uncheck();
    await expect(checkbox).not.toBeChecked();
    expectClean(errors);
  });

  // ── Test 6: payment.succeeded checkbox toggles ────────────────────────────

  test('06 webhooks-event-payment.succeeded checkbox: check → assert checked → uncheck', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin/settings#webhooks');
    const panel = page.getByTestId('settings-webhooks-panel');
    await expect(panel).toBeVisible({ timeout: 15_000 });
    const checkbox = panel.getByTestId('webhooks-event-payment.succeeded');
    await expect(checkbox).toBeVisible();
    if (await checkbox.isChecked()) { await checkbox.uncheck(); }
    await checkbox.check();
    await expect(checkbox).toBeChecked();
    await snap(page, '06-webhooks-event-payment-succeeded-checked');
    await checkbox.uncheck();
    await expect(checkbox).not.toBeChecked();
    expectClean(errors);
  });

  // ── Test 7: build.failed checkbox toggles ─────────────────────────────────

  test('07 webhooks-event-build.failed checkbox: check → assert checked → uncheck', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin/settings#webhooks');
    const panel = page.getByTestId('settings-webhooks-panel');
    await expect(panel).toBeVisible({ timeout: 15_000 });
    const checkbox = panel.getByTestId('webhooks-event-build.failed');
    await expect(checkbox).toBeVisible();
    if (await checkbox.isChecked()) { await checkbox.uncheck(); }
    await checkbox.check();
    await expect(checkbox).toBeChecked();
    await snap(page, '07-webhooks-event-build-failed-checked');
    await checkbox.uncheck();
    await expect(checkbox).not.toBeChecked();
    expectClean(errors);
  });

  // ── Test 8: review.received + domain.active both toggle ───────────────────

  test('08 webhooks-event-review.received and domain.active checkboxes both toggle', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin/settings#webhooks');
    const panel = page.getByTestId('settings-webhooks-panel');
    await expect(panel).toBeVisible({ timeout: 15_000 });
    for (const testid of [
      'webhooks-event-review.received',
      'webhooks-event-domain.active',
    ] as const) {
      const checkbox = panel.getByTestId(testid);
      await expect(checkbox).toBeVisible();
      if (await checkbox.isChecked()) { await checkbox.uncheck(); }
      await checkbox.check();
      await expect(checkbox).toBeChecked();
      await checkbox.uncheck();
      await expect(checkbox).not.toBeChecked();
    }
    await snap(page, '08-webhooks-review-domain-toggled');
    expectClean(errors);
  });

  // ── Test 9: Create button present and disabled when URL is empty ───────────

  test('09 webhooks-create-btn is visible; disabled when URL field is empty', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin/settings#webhooks');
    const panel = page.getByTestId('settings-webhooks-panel');
    await expect(panel).toBeVisible({ timeout: 15_000 });
    const createBtn = panel.getByTestId('webhooks-create-btn');
    await expect(createBtn).toBeVisible();
    // Clear the URL input to ensure disabled state
    const urlInput = panel.getByTestId('webhooks-url');
    if (await urlInput.count()) {
      await urlInput.fill('');
    }
    await expect(createBtn).toBeDisabled();
    await snap(page, '09-webhooks-create-btn-disabled-no-url');
    expectClean(errors);
  });

  // ── Test 10: Create button ENABLED with URL + ≥1 event (no submit) ─────────

  test('10 webhooks-create-btn becomes enabled once URL + ≥1 event selected (no submit)', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin/settings#webhooks');
    const panel = page.getByTestId('settings-webhooks-panel');
    await expect(panel).toBeVisible({ timeout: 15_000 });
    // Fill URL
    const urlInput = panel.getByTestId('webhooks-url');
    await expect(urlInput).toBeVisible();
    await urlInput.fill('https://example.com/hook');
    await expect(urlInput).toHaveValue('https://example.com/hook');
    // Select one event
    const eventCheckbox = panel.getByTestId('webhooks-event-site.published');
    await expect(eventCheckbox).toBeVisible();
    if (!(await eventCheckbox.isChecked())) {
      await eventCheckbox.check();
    }
    await expect(eventCheckbox).toBeChecked();
    // Assert create button is now enabled — STOP, do not click
    const createBtn = panel.getByTestId('webhooks-create-btn');
    await expect(createBtn).toBeEnabled();
    await snap(page, '10-webhooks-create-btn-enabled-ready');
    expectClean(errors);
  });

  // ── Test 11: Deep-link + reload preserves the panel ───────────────────────

  test('11 hard reload of deep-link /admin/settings#webhooks re-renders panel cleanly', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin/settings#webhooks');
    const panel = page.getByTestId('settings-webhooks-panel');
    await expect(panel).toBeVisible({ timeout: 15_000 });
    // Reload and re-assert — tab must survive cold load
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('settings-webhooks-panel')).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole('heading', { name: /outbound webhooks/i }),
    ).toBeVisible();
    await snap(page, '11-webhooks-deep-link-reload');
    expectClean(errors);
  });

  // ── Test 12: Keyboard focus reaches URL input ──────────────────────────────

  test.fixme('12 Tab navigation reaches webhooks-url input within 20 presses', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin/settings#webhooks');
    const panel = page.getByTestId('settings-webhooks-panel');
    await expect(panel).toBeVisible({ timeout: 15_000 });
    // Click the panel to anchor focus inside Settings section
    await panel.click();
    const urlInput = panel.getByTestId('webhooks-url');
    await expect(urlInput).toBeVisible();
    let focused = false;
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press('Tab');
      const activeTestId = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        return el?.getAttribute('data-testid') ?? null;
      });
      if (activeTestId === 'webhooks-url') {
        focused = true;
        break;
      }
    }
    expect(focused, 'webhooks-url input must be reachable by Tab keyboard navigation').toBe(true);
    await snap(page, '12-webhooks-url-keyboard-focused');
    expectClean(errors);
  });

  // ── Test 13: Console hygiene ───────────────────────────────────────────────

  test('13 console is error-free when webhooks panel renders with honest empty state', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin/settings#webhooks');
    const panel = page.getByTestId('settings-webhooks-panel');
    await expect(panel).toBeVisible({ timeout: 15_000 });
    // Light interaction to exercise the panel without mutating
    const urlInput = panel.getByTestId('webhooks-url');
    if (await urlInput.count()) {
      await urlInput.click();
      await page.keyboard.press('Escape');
    }
    await snap(page, '13-webhooks-console-clean');
    expectClean(errors);
  });

  // ── Test 14: Full journey (no submit) ─────────────────────────────────────

  test('14 full journey: land → empty state → fill URL → select 2 events → create btn enabled (no submit)', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin/settings#webhooks');
    const panel = page.getByTestId('settings-webhooks-panel');
    await expect(panel).toBeVisible({ timeout: 15_000 });

    // Step 1: Heading visible
    await expect(
      panel.getByRole('heading', { name: /outbound webhooks/i }),
    ).toBeVisible();
    await snap(page, '14-full-journey-01-panel-ready');

    // Step 2: Honest empty state
    const emptyEl = panel.getByTestId('empty-state');
    if (await emptyEl.count()) {
      await expect(emptyEl).toBeVisible();
    } else {
      await expect(panel.getByText(/no webhook endpoints/i)).toBeVisible();
    }
    await snap(page, '14-full-journey-02-empty-state');

    // Step 3: Fill the URL
    const urlInput = panel.getByTestId('webhooks-url');
    await expect(urlInput).toBeVisible();
    await urlInput.fill('https://example.com/hook');
    await expect(urlInput).toHaveValue('https://example.com/hook');
    await snap(page, '14-full-journey-03-url-filled');

    // Step 4: Select 2 events
    const event1 = panel.getByTestId('webhooks-event-site.published');
    const event2 = panel.getByTestId('webhooks-event-form.submitted');
    await expect(event1).toBeVisible();
    await expect(event2).toBeVisible();
    if (!(await event1.isChecked())) { await event1.check(); }
    await expect(event1).toBeChecked();
    if (!(await event2.isChecked())) { await event2.check(); }
    await expect(event2).toBeChecked();
    await snap(page, '14-full-journey-04-events-selected');

    // Step 5: Create button enabled — STOP, never submit
    const createBtn = panel.getByTestId('webhooks-create-btn');
    await expect(createBtn).toBeEnabled();
    await snap(page, '14-full-journey-05-create-btn-enabled');

    expectClean(errors);
  });
});
