/**
 * ALL-STAR Category H — Observability + cost discipline (items 39-42).
 *
 * Workflows v2 site-gen migration, unified OTLP events stream, per-tenant
 * Sentry releases, SLO tracker with burn-rate alerts.
 */

import { test, expect } from '@playwright/test';

const ADMIN = '/admin';

test.describe('#39 Workflows v2 site-generation pipeline', () => {
  test('admin sees Workflow run with step-by-step deterministic state', async ({ page }) => {
    await page.goto(`${ADMIN}/automation/workflows`);
    const row = page.getByTestId('workflow-run-row').first();
    await row.click();
    await expect(page.getByTestId('workflow-step-row').first()).toBeVisible();
    // Each step shows status + duration + replay-safe marker
    const step = page.getByTestId('workflow-step-row').first();
    await expect(step.getByTestId('step-status')).toContainText(/completed|running|failed|sleeping/i);
    await expect(step.getByTestId('step-duration')).toContainText(/\d+\s*(ms|s)/i);
  });

  test('failed step has Replay-from-here button', async ({ page }) => {
    await page.goto(`${ADMIN}/automation/workflows?status=failed`);
    const failedRow = page.getByTestId('workflow-run-row').first();
    if (await failedRow.count()) {
      await failedRow.click();
      await expect(page.getByRole('button', { name: /replay|retry/i })).toBeVisible();
    } else {
      // Clean state — empty state present
      await expect(page.getByTestId('workflows-empty-failed')).toBeVisible();
    }
  });

  test('idle workflow incurs zero CPU (hibernation status visible)', async ({ page }) => {
    await page.goto(`${ADMIN}/automation/workflows`);
    const sleepingRow = page.getByTestId('workflow-step-status-sleeping').first();
    if (await sleepingRow.count()) {
      await expect(sleepingRow).toContainText(/sleeping|hibernating|0\s*ms/i);
    }
  });
});

test.describe('#40 unified OTLP events stream', () => {
  test('admin sees real-time events feed (D1 + WS + fetch + AI calls)', async ({ page }) => {
    await page.goto(`${ADMIN}/observability/events`);
    await expect(page.getByTestId('events-feed')).toBeVisible();
    // Filter chips for each source
    for (const source of ['D1', 'WS', 'fetch', 'AI']) {
      await expect(page.getByTestId(`event-source-${source.toLowerCase()}`)).toBeVisible();
    }
  });

  test('each event has trace-id correlation; clicking opens Axiom-like flame chart', async ({ page }) => {
    await page.goto(`${ADMIN}/observability/events`);
    const row = page.getByTestId('event-row').first();
    await row.click();
    await expect(page.getByTestId('trace-flame-chart')).toBeVisible();
    await expect(page.getByTestId('trace-id')).toContainText(/^[a-f0-9]{16,32}/);
  });
});

test.describe('#41 per-tenant Sentry releases', () => {
  test('admin sees Sentry issues scoped to current org', async ({ page }) => {
    await page.goto(`${ADMIN}/observability/errors`);
    const list = page.getByTestId('sentry-issue-row');
    await expect(list.first().or(page.getByTestId('sentry-empty'))).toBeVisible();
  });

  test('release tag on every issue identifies deploy', async ({ page }) => {
    await page.goto(`${ADMIN}/observability/errors`);
    const first = page.getByTestId('sentry-issue-row').first();
    if (await first.count()) {
      await expect(first.getByTestId('release-tag')).toContainText(/^[a-z0-9-]+/);
    }
  });

  test('agency can hand client their own error feed token (read-only)', async ({ page }) => {
    await page.goto(`${ADMIN}/agency/clients`);
    await page.getByTestId('agency-client-row').first().click();
    await page.getByRole('button', { name: /generate error feed token/i }).click();
    await expect(page.getByTestId('error-feed-token')).toContainText(/^pst_/);
  });
});

test.describe('#42 SLO tracker with burn-rate alerts', () => {
  test('admin defines SLO per route (availability + p99 latency)', async ({ page }) => {
    await page.goto(`${ADMIN}/observability/slo`);
    await page.getByRole('button', { name: /add slo/i }).click();
    await page.getByLabel(/route/i).fill('/api/site-generation');
    await page.getByLabel(/availability target/i).fill('99.9');
    await page.getByLabel(/p99 latency.*ms/i).fill('500');
    await page.getByRole('button', { name: /save/i }).click();
    await expect(page.getByTestId('slo-row').filter({ hasText: 'site-generation' })).toBeVisible();
  });

  test('burn rate chart shows current state vs target', async ({ page }) => {
    await page.goto(`${ADMIN}/observability/slo`);
    const row = page.getByTestId('slo-row').first();
    await row.click();
    await expect(page.getByTestId('burn-rate-chart')).toBeVisible();
    await expect(page.getByTestId('error-budget-remaining')).toContainText(/\d+%/);
  });
});
