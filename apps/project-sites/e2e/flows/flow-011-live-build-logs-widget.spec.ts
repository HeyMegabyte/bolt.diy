/**
 * @file flow-011-live-build-logs-widget.spec.ts
 * @description FLOW_CATALOG.md #11–13 (Group B, ⭐ flagship) — the LIVE CLAUDE-CODE
 * LOGS WIDGET on `/waiting`.
 *
 * TDD-RED acceptance for the centerpiece feature request: while a site builds, `/waiting`
 * shows a GORGEOUS terminal-style widget streaming the real Claude Code build output (not
 * just the current 8-step label pipeline), it tails live, and it OVERLAYS the not-yet-
 * available content (site preview / "View site" CTA) until `workflow_status === completed`.
 *
 * This spec drives BUILDING that widget. It exercises the widget in isolation by feeding
 * `/api/sites/:id/workflow` a "building + logs" state via route interception — the DATA feed
 * is simulated, but the WIDGET (the thing under construction) renders from the real app. The
 * real end-to-end build is Flow #1 (`create-edit-publish-flow.spec.ts`, `E2E_REAL_BUILD=1`).
 *
 * Contract the feature must satisfy (data-testids the widget should expose):
 *   [data-testid="live-build-logs"]   — the terminal widget container (role="log", aria-live="polite")
 *   [data-testid="build-log-line"]    — one rendered raw log line (monospace)
 *   [data-testid="build-overlay"]     — the overlay covering unavailable content until done
 *   [data-testid="build-phase-chip"]  — per-phase active/done/error chips synced to the log tail
 *
 * Run: E2E_FLOWS=1 PROD_URL=https://projectsites.dev npx playwright test flow-011 --config=playwright.prod.config.ts
 */
import { test, expect } from '@playwright/test';
import { signInAsTestUser } from '../helpers/auth.js';

const PROD_URL = process.env.PROD_URL ?? 'https://projectsites.dev';
const RUN = process.env.E2E_FLOWS === '1';

// A simulated building workflow with real-looking Claude Code stdout.
const BUILDING_WORKFLOW = {
  data: {
    site_id: 'flow-011-site',
    workflow_available: true,
    workflow_status: 'running',
    site_status: 'building',
    recent_logs: [
      {
        action: 'workflow.started',
        message: '▶ Starting build pipeline for flow-011…',
        created_at: '2026-08-15T03:00:00Z',
      },
      {
        action: 'workflow.step.profile_research_started',
        message: '[research] fanning out: profile · brand · social · images',
        created_at: '2026-08-15T03:00:05Z',
      },
      {
        action: 'container.stdout',
        message: 'claude: customizing template → dist (deepseek-chat)',
        created_at: '2026-08-15T03:00:20Z',
      },
      {
        action: 'container.stdout',
        message: 'validator-fixer: 0 blockers remaining',
        created_at: '2026-08-15T03:00:40Z',
      },
    ],
  },
};

test.describe('Flow #11–13 — live Claude Code build-logs widget on /waiting', () => {
  test.skip(!RUN, 'Set E2E_FLOWS=1 to run FLOW_CATALOG specs (RED until the widget ships).');

  test.beforeEach(async ({ page }) => {
    // Feed the widget a deterministic "building + logs" state.
    await page.route('**/api/sites/*/workflow', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(BUILDING_WORKFLOW),
      }),
    );
  });

  test('renders a gorgeous live-logs terminal widget streaming the raw build output', async ({
    page,
  }) => {
    await signInAsTestUser(page);
    await page.goto(`${PROD_URL}/waiting?id=flow-011-site&slug=flow-011`, {
      waitUntil: 'domcontentloaded',
    });

    const widget = page.getByTestId('live-build-logs');
    await expect(widget, 'the live-logs terminal widget must render while building').toBeVisible({
      timeout: 15_000,
    });

    // Accessibility contract for a streaming log region.
    await expect(widget).toHaveAttribute('role', 'log');
    await expect(widget).toHaveAttribute('aria-live', 'polite');

    // The RAW Claude Code stdout must appear — not only the step-label pipeline.
    await expect(page.getByText('claude: customizing template → dist')).toBeVisible();
    await expect(page.getByTestId('build-log-line').first()).toBeVisible();
    expect(await page.getByTestId('build-log-line').count()).toBeGreaterThanOrEqual(4);
  });

  test('overlays the not-yet-available content until the build completes', async ({ page }) => {
    await signInAsTestUser(page);
    await page.goto(`${PROD_URL}/waiting?id=flow-011-site&slug=flow-011`, {
      waitUntil: 'domcontentloaded',
    });

    // While building: the overlay is present and the "View site" CTA is not yet actionable.
    await expect(page.getByTestId('build-overlay')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('link', { name: /view (your )?site/i })).toHaveCount(0);
  });

  test('shows per-phase status chips synced to the live log tail', async ({ page }) => {
    await signInAsTestUser(page);
    await page.goto(`${PROD_URL}/waiting?id=flow-011-site&slug=flow-011`, {
      waitUntil: 'domcontentloaded',
    });

    const chips = page.getByTestId('build-phase-chip');
    await expect(chips.first()).toBeVisible({ timeout: 15_000 });
    // The "research" phase is active per the fed logs.
    await expect(
      page.getByTestId('build-phase-chip').filter({ hasText: /research/i }),
    ).toBeVisible();
  });

  test('the widget never leaks secrets in the streamed output', async ({ page }) => {
    await page.route('**/api/sites/*/workflow', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            ...BUILDING_WORKFLOW.data,
            recent_logs: [
              {
                action: 'container.stdout',
                message: 'ANTHROPIC_AUTH_TOKEN=sk-ant-should-be-redacted',
                created_at: '2026-08-15T03:01:00Z',
              },
            ],
          },
        }),
      }),
    );
    await signInAsTestUser(page);
    await page.goto(`${PROD_URL}/waiting?id=flow-011-site&slug=flow-011`, {
      waitUntil: 'domcontentloaded',
    });
    await expect(page.getByTestId('live-build-logs')).toBeVisible({ timeout: 15_000 });
    // A leaked key must be redacted before it reaches the DOM.
    await expect(page.locator('body')).not.toContainText('sk-ant-should-be-redacted');
  });
});
