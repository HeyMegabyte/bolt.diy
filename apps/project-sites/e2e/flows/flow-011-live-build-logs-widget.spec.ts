/**
 * @file flow-011-live-build-logs-widget.spec.ts
 * @description FLOW_CATALOG.md #11–13 (Group B, ⭐ flagship) — the LIVE CLAUDE-CODE
 * LOGS WIDGET on `/waiting`.
 *
 * Acceptance for the centerpiece feature: while a site builds, `/waiting` shows a GORGEOUS
 * terminal-style widget streaming the build event log (not just the current step label), it
 * tails live, OVERLAYS the not-yet-available content until published, shows per-phase chips,
 * and REDACTS secrets. The real 40-min end-to-end build is Flow #1
 * (`create-edit-publish-flow.spec.ts`, `E2E_REAL_BUILD=1`).
 *
 * Widget in isolation: the DATA feed (the two endpoints `/waiting` polls — `/api/sites/:id`
 * and `/api/sites/:id/logs`) is simulated via route interception, but the WIDGET renders from
 * the REAL deployed app. `LogEntry` = { id, action, created_at, metadata_json } — the raw
 * message lives in `metadata_json.message` (there is no top-level `message`).
 *
 * Testids the widget exposes:
 *   [data-testid="live-build-logs"]   — the terminal (role="log", aria-live="polite")
 *   [data-testid="build-log-line"]    — one rendered line
 *   [data-testid="build-overlay"]     — the building takeover overlaying the not-yet-ready site
 *   [data-testid="build-phase-chip"]  — per-phase chips synced to the step
 *
 * Run: E2E_FLOWS=1 PROD_URL=https://projectsites.dev npx playwright test flow-011 --config=playwright.prod.config.ts
 */
import { test, expect, type Page } from '@playwright/test';

const PROD_URL = process.env.PROD_URL ?? 'https://projectsites.dev';
const RUN = process.env.E2E_FLOWS === '1';

const SITE_ID = 'flow-011-site';
const SLUG = 'flow-011';

/** LogEntry rows as the worker's audit log returns them (raw text in metadata_json). */
function logs(rows: { action: string; message?: string; created_at?: string }[]) {
  return {
    data: rows.map((r, i) => ({
      id: `log-${i}`,
      action: r.action,
      created_at: r.created_at ?? '2026-08-15T03:00:00Z',
      metadata_json: r.message ? JSON.stringify({ message: r.message }) : undefined,
    })),
  };
}

const DEFAULT_LOGS = logs([
  { action: 'workflow.started', message: '▶ Starting build pipeline for flow-011…' },
  {
    action: 'workflow.step.profile_research_started',
    message: '[research] fanning out: profile · brand · social · images',
  },
  { action: 'container.stdout', message: 'claude: customizing template → dist (deepseek-chat)' },
  { action: 'container.stdout', message: 'validator-fixer: 0 blockers remaining' },
]);

/** Feed `/waiting` a deterministic "building + logs" state. Logs route registered LAST so it wins. */
async function stubBuilding(page: Page, logsBody: unknown = DEFAULT_LOGS): Promise<void> {
  await page.route('**/api/sites/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { id: SITE_ID, slug: SLUG, status: 'building' } }),
    }),
  );
  await page.route('**/api/sites/*/logs**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(logsBody) }),
  );
}

async function gotoWaiting(page: Page): Promise<void> {
  await page.goto(`${PROD_URL}/waiting?id=${SITE_ID}&slug=${SLUG}`, {
    waitUntil: 'domcontentloaded',
  });
}

test.describe('Flow #11–13 — live Claude Code build-logs widget on /waiting', () => {
  test.skip(!RUN, 'Set E2E_FLOWS=1 to run FLOW_CATALOG specs.');

  test('renders a gorgeous live-logs terminal widget streaming the build output', async ({
    page,
  }) => {
    await stubBuilding(page);
    await gotoWaiting(page);

    const widget = page.getByTestId('live-build-logs');
    await expect(widget, 'the live-logs terminal widget must render while building').toBeVisible({
      timeout: 15_000,
    });
    await expect(widget).toHaveAttribute('role', 'log');
    await expect(widget).toHaveAttribute('aria-live', 'polite');

    // The raw build output must appear — not only the single step label.
    await expect(page.getByText('claude: customizing template → dist')).toBeVisible();
    await expect(page.getByTestId('build-log-line').first()).toBeVisible();
    expect(await page.getByTestId('build-log-line').count()).toBeGreaterThanOrEqual(4);
  });

  test('overlays the not-yet-available content until the build completes', async ({ page }) => {
    await stubBuilding(page);
    await gotoWaiting(page);

    await expect(page.getByTestId('build-overlay')).toBeVisible({ timeout: 15_000 });
    // While building the "View site" CTA (a published-only affordance) is absent.
    await expect(page.getByRole('button', { name: /view (your )?site/i })).toHaveCount(0);
  });

  test('shows per-phase status chips synced to the live log tail', async ({ page }) => {
    await stubBuilding(page);
    await gotoWaiting(page);

    await expect(page.getByTestId('build-phase-chip').first()).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByTestId('build-phase-chip').filter({ hasText: /research/i }),
    ).toBeVisible();
  });

  test('never leaks a secret from the streamed output', async ({ page }) => {
    await stubBuilding(
      page,
      logs([
        { action: 'container.stdout', message: 'ANTHROPIC_AUTH_TOKEN=sk-ant-should-be-redacted' },
      ]),
    );
    await gotoWaiting(page);

    await expect(page.getByTestId('live-build-logs')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('body')).not.toContainText('sk-ant-should-be-redacted');
  });
});
