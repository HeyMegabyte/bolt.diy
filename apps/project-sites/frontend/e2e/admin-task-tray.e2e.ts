import { test, expect, type Page } from '@playwright/test';

/**
 * Prod lock for the AI Task Tray overlay being mounted in the admin shell.
 *
 * `TaskTrayComponent` (`components/task-tray`) is a self-contained, passive
 * top-right overlay that polls `GET /api/inbox/tasks` and surfaces
 * human-in-the-loop elicitation prompts posted by long-running Workflows.
 * Its JSDoc says "mounted once in the admin shell" — but it was imported into
 * AdminComponent and never rendered (NG8113 unused-import = a dead feature
 * surface). This locks that the host element is present in the shell so the
 * tray can show cards the moment a workflow calls `postAskUser`.
 *
 * The host renders nothing INSIDE when the inbox is empty (the common case),
 * so we assert the host element exists + carries its accessible label, not
 * that any card is visible.
 *
 * Run: E2E_API_KEY=$(get-secret E2E_API_KEY) \
 *   npx playwright test --config=playwright.prod.config.ts admin-task-tray
 */
const KEY = process.env.E2E_API_KEY ?? '';

async function seed(page: Page): Promise<void> {
  await page.addInitScript((k: string) => {
    try {
      localStorage.setItem('ps_session', JSON.stringify({ token: k, identifier: 'brian@megabyte.space', createdAt: Date.now() }));
      localStorage.setItem('ps_feedback_dismissed', 'true');
    } catch { /* private mode */ }
  }, KEY);
}

test.describe('admin — AI task tray mounted in shell (prod lock)', () => {
  test.skip(!KEY, 'E2E_API_KEY not set');
  test.describe.configure({ retries: 2 });

  for (const route of ['/admin', '/admin/sites']) {
    test(`task-tray host is present in the shell: ${route}`, async ({ page }) => {
      await seed(page);
      await page.goto(route, { waitUntil: 'domcontentloaded' }).catch(() => {});
      await page.waitForTimeout(4000);
      const tray = page.locator('app-task-tray');
      await expect(tray).toHaveCount(1);
      // The overlay carries its accessible name + polite live region even when empty.
      await expect(tray).toHaveAttribute('aria-label', 'AI task tray');
      await expect(tray).toHaveAttribute('aria-live', 'polite');
    });
  }
});
