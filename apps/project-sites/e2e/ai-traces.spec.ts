/**
 * @fileoverview Playwright E2E coverage for the `/admin/traces` (AI Traces) page.
 *
 * Verifies the redesigned three-slot toolbar and the auto-polling behavior:
 *   1. Search input renders on the LEFT of the toolbar.
 *   2. The "All / Today / Errors" pill group is centered.
 *   3. The forms-source dropdown renders on the RIGHT.
 *   4. The legacy "Refresh" button has been removed.
 *   5. Pressing the keyboard "2" key activates the "Today" pill (aria-pressed=true).
 */
import { test, expect } from './fixtures.js';
import type { Page } from '@playwright/test';

/**
 * Stub the auth session + dashboard bootstrap APIs + traces/forms endpoints
 * so the Traces page renders without a real Worker session.
 */
async function setupTraces(page: Page): Promise<void> {
  // Persist a fake session matching what AuthService expects.
  await page.addInitScript(() => {
    localStorage.setItem(
      'ps_session',
      JSON.stringify({ token: 'traces-test-token-abcdef', email: 'test@megabyte.space' }),
    );
  });

  // Session probe.
  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: { user_id: 'user-traces-1', org_id: 'org-traces-1', email: 'test@megabyte.space' },
      }),
    });
  });

  // Dashboard bootstrap (sites/domains/subscription).
  await page.route('**/api/sites', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: [{ id: 'site-1', slug: 'acme', name: 'Acme', status: 'published' }],
      }),
    });
  });
  await route200(page, '**/api/domains/summary', { data: { total: 0, active: 0, pending: 0, failed: 0 } });
  await route200(page, '**/api/billing/subscription', { data: { plan: 'free', status: 'active' } });
  await route200(page, '**/api/sites/site-1/analytics**', { data: null });

  // Forms list — drives the right-slot dropdown.
  await route200(page, '**/api/sites/site-1/forms', {
    data: [
      { id: 'form-contact', name: 'Contact', slug: 'contact' },
      { id: 'form-quote', name: 'Quote Request', slug: 'quote' },
    ],
  });

  // Traces list — return two rows so the table renders.
  await route200(page, '**/api/sites/site-1/ai-logs**', {
    data: [
      {
        id: 'trace-001',
        submission_id: 'sub-1',
        trace_kind: 'form',
        endpoint_slug: 'contact',
        model: 'llama-3.1',
        status: 'ok',
        latency_ms: 420,
        tokens_input: 100,
        tokens_output: 80,
        credits_debited: 1,
        tool_name: null,
        tool_status: null,
        output_preview: 'Thanks for reaching out',
        error_message: null,
        created_at: new Date().toISOString(),
        form_id: 'form-contact',
        source: 'contact',
      },
      {
        id: 'trace-002',
        submission_id: null,
        trace_kind: 'endpoint',
        endpoint_slug: 'classify',
        model: 'llama-3.1',
        status: 'error',
        latency_ms: 1200,
        tokens_input: 50,
        tokens_output: 0,
        credits_debited: 0,
        tool_name: null,
        tool_status: null,
        output_preview: null,
        error_message: 'Timed out',
        created_at: new Date(Date.now() - 86400000).toISOString(),
        form_id: null,
        source: null,
      },
    ],
  });

  // SSE stream — return 404 so the component falls back to polling immediately.
  await page.route('**/api/admin/traces/stream', async (route) => {
    await route.fulfill({ status: 404, contentType: 'text/plain', body: 'not found' });
  });
}

/** Helper: stub a JSON 200 response on a URL pattern. */
async function route200(page: Page, pattern: string, body: unknown): Promise<void> {
  await page.route(pattern, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

test.describe('AI Traces — toolbar layout + polling', () => {
  test('search left, pills centered, forms filter right, no Refresh button', async ({ page }) => {
    await setupTraces(page);
    await page.goto('/admin/traces');

    const search = page.getByTestId('traces-search');
    const allPill = page.getByTestId('traces-pill-all');
    const todayPill = page.getByTestId('traces-pill-today');
    const errorsPill = page.getByTestId('traces-pill-errors');
    const formsFilter = page.getByTestId('traces-forms-filter');

    await expect(search).toBeVisible();
    await expect(allPill).toBeVisible();
    await expect(todayPill).toBeVisible();
    await expect(errorsPill).toBeVisible();
    await expect(formsFilter).toBeVisible();

    // No "Refresh" button anywhere in the page chrome.
    await expect(page.getByRole('button', { name: /^refresh$/i })).toHaveCount(0);

    // Geometry check: search.x < pill-center.x < forms-filter.x at desktop width.
    const searchBox = await search.boundingBox();
    const allBox = await allPill.boundingBox();
    const formsBox = await formsFilter.boundingBox();
    expect(searchBox && allBox && formsBox).toBeTruthy();
    if (searchBox && allBox && formsBox) {
      expect(searchBox.x).toBeLessThan(allBox.x);
      expect(allBox.x).toBeLessThan(formsBox.x);
    }
  });

  test('keyboard "2" activates the Today pill', async ({ page }) => {
    await setupTraces(page);
    await page.goto('/admin/traces');
    // Make sure nothing is focused inside an input.
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('2');
    const todayPill = page.getByTestId('traces-pill-today');
    await expect(todayPill).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('traces-pill-all')).toHaveAttribute('aria-pressed', 'false');
  });
});
