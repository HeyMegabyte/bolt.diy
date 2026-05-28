/**
 * Per-project tabs — TAB-01 through TAB-13.
 *
 * Prompt-specified surface: site detail page exposes 4 tabs (Logs, Snapshots
 * merged with Deploy History + Rollback, SQL, Integrations). All tests start
 * from `/`, navigate via real user actions, auth as the mocked admin.
 *
 * Hard-rule reminder: NEVER weaken these tests to make them pass. App code
 * satisfies the test as written.
 */
import { test, expect } from '../fixtures.js';
import type { Page } from '@playwright/test';

const TEST_SITE_ID = 'e2e-test-site-id';
const TEST_SITE_SLUG = 'e2e-test-site';

/** Real-user navigation from homepage → admin → first site detail. */
async function gotoSiteDetail(page: Page): Promise<void> {
  // Stub site list so the admin shell has a deterministic row to click.
  await page.route('**/api/sites', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        sites: [
          {
            id: TEST_SITE_ID,
            slug: TEST_SITE_SLUG,
            name: 'E2E Test Site',
            status: 'published',
            created_at: '2026-05-01T00:00:00Z',
            updated_at: '2026-05-27T00:00:00Z',
          },
        ],
      }),
    });
  });

  await page.goto('/admin/sites');
  await page.getByRole('link', { name: /e2e test site/i }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/sites/${TEST_SITE_ID}`));
}

test.describe('Per-project tabs — Logs', () => {
  test('TAB-01 — Logs tab tails build/runtime logs via websocket', async ({ authedPage: page }) => {
    await gotoSiteDetail(page);
    await page.getByRole('tab', { name: /logs/i }).click();
    await expect(page.getByTestId('site-logs-tail')).toBeVisible();
    await expect(page.getByTestId('site-logs-ws-status')).toContainText(/connected|live/i);
  });

  test('TAB-02 — Logs tab supports level filter + search', async ({ authedPage: page }) => {
    await gotoSiteDetail(page);
    await page.getByRole('tab', { name: /logs/i }).click();
    await page.getByLabel(/level/i).selectOption('error');
    await page.getByPlaceholder(/search logs/i).fill('build failed');
    await expect(page.getByTestId('site-logs-row')).toContainText(/build failed/i);
  });
});

test.describe('Per-project tabs — Snapshots + Rollback', () => {
  test('TAB-03 — Snapshots tab merges deploy history + snapshots', async ({ authedPage: page }) => {
    await gotoSiteDetail(page);
    await page.getByRole('tab', { name: /snapshots/i }).click();
    await expect(page.getByTestId('site-snapshots-list')).toBeVisible();
    // Merged surface — both AI-named edit snapshots AND deploy-history entries appear in one list.
    await expect(page.getByTestId('snapshot-row').first()).toBeVisible();
  });

  test('TAB-04 — Each snapshot row has a rollback button', async ({ authedPage: page }) => {
    await gotoSiteDetail(page);
    await page.getByRole('tab', { name: /snapshots/i }).click();
    const row = page.getByTestId('snapshot-row').first();
    await expect(row.getByRole('button', { name: /rollback/i })).toBeVisible();
  });

  test('TAB-05 — Clicking rollback confirms then re-deploys old version', async ({ authedPage: page }) => {
    await gotoSiteDetail(page);
    await page.getByRole('tab', { name: /snapshots/i }).click();
    const row = page.getByTestId('snapshot-row').first();
    await row.getByRole('button', { name: /rollback/i }).click();
    await page.getByRole('button', { name: /confirm rollback/i }).click();
    await expect(page.getByText(/rolled back to/i)).toBeVisible({ timeout: 10_000 });
  });

  test('TAB-06 — AI-named edit snapshots render with their name', async ({ authedPage: page }) => {
    await gotoSiteDetail(page);
    await page.getByRole('tab', { name: /snapshots/i }).click();
    await expect(page.getByTestId('snapshot-ai-name').first()).toBeVisible();
  });
});

test.describe('Per-project tabs — SQL', () => {
  test('TAB-07 — Run SELECT against per-site D1', async ({ authedPage: page }) => {
    await gotoSiteDetail(page);
    await page.getByRole('tab', { name: /sql/i }).click();
    await page.getByTestId('sql-editor').fill('SELECT 1 AS n;');
    await page.getByRole('button', { name: /^run$/i }).click();
    await expect(page.getByTestId('sql-result-cell')).toContainText('1');
  });

  test('TAB-08 — DDL (DROP/ALTER) rejected', async ({ authedPage: page }) => {
    await gotoSiteDetail(page);
    await page.getByRole('tab', { name: /sql/i }).click();
    await page.getByTestId('sql-editor').fill('DROP TABLE sites;');
    await page.getByRole('button', { name: /^run$/i }).click();
    await expect(page.getByTestId('sql-error')).toContainText(/ddl not allowed|read-only/i);
  });

  test('TAB-09 — Query history persists across reload', async ({ authedPage: page }) => {
    await gotoSiteDetail(page);
    await page.getByRole('tab', { name: /sql/i }).click();
    await page.getByTestId('sql-editor').fill('SELECT 42 AS answer;');
    await page.getByRole('button', { name: /^run$/i }).click();
    await page.reload();
    await page.getByRole('tab', { name: /sql/i }).click();
    await expect(page.getByTestId('sql-history-item')).toContainText(/42/);
  });
});

test.describe('Per-project tabs — Integrations', () => {
  test('TAB-10 — Integrations tab lists MCP providers per-site', async ({ authedPage: page }) => {
    await gotoSiteDetail(page);
    await page.getByRole('tab', { name: /integrations/i }).click();
    await expect(page.getByTestId('mcp-provider-list')).toBeVisible();
    await expect(page.getByTestId('mcp-provider-card-mailchimp')).toBeVisible();
    await expect(page.getByTestId('mcp-provider-card-stripe')).toBeVisible();
    await expect(page.getByTestId('mcp-provider-card-hubspot')).toBeVisible();
  });

  test('TAB-11 — Connect Mailchimp via OAuth opens popup', async ({ authedPage: page }) => {
    await gotoSiteDetail(page);
    await page.getByRole('tab', { name: /integrations/i }).click();
    const [popup] = await Promise.all([
      page.waitForEvent('popup'),
      page.getByTestId('mcp-provider-card-mailchimp').getByRole('button', { name: /connect/i }).click(),
    ]);
    await expect(popup).toHaveURL(/authorize|oauth/);
  });

  test('TAB-12 — Paste-key fallback when OAuth unconfigured', async ({ authedPage: page }) => {
    // Force 501 oauth_not_configured to trigger paste-key UX.
    await page.route('**/api/mcp/resend/connect**', async (route) => {
      await route.fulfill({
        status: 501,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'oauth_not_configured', provider: 'resend' }),
      });
    });
    await gotoSiteDetail(page);
    await page.getByRole('tab', { name: /integrations/i }).click();
    await page.getByTestId('mcp-provider-card-resend').getByRole('button', { name: /connect/i }).click();
    await expect(page.getByTestId('mcp-paste-key-form')).toBeVisible();
    await expect(page.getByPlaceholder(/api key/i)).toBeVisible();
  });

  test('TAB-13 — Disconnect provider clears mcp_connections row', async ({ authedPage: page }) => {
    await gotoSiteDetail(page);
    await page.getByRole('tab', { name: /integrations/i }).click();
    const card = page.getByTestId('mcp-provider-card-mailchimp');
    // Assume previously connected — assert disconnect button visible.
    await card.getByRole('button', { name: /disconnect/i }).click();
    await page.getByRole('button', { name: /confirm/i }).click();
    await expect(card.getByRole('button', { name: /connect/i })).toBeVisible();
  });
});
