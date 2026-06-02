/**
 * @module e2e/admin-network-honesty
 *
 * Two campaign regression guards:
 *
 * 1. Double-`/api` bug class (rounds 28). `ApiService` already prepends `/api`,
 *    so any call passing `/api/...` produced `/api/api/...` → 404, silently
 *    breaking whole features (logs-explorer search/cost, MCP paste-connect).
 *    Guard: navigate the admin routes and assert NO request URL ever contains
 *    `/api/api/`. Catches every current + future instance of the bug class.
 *
 * 2. Honesty labels (round 32). swarm + progressive-preview present simulated
 *    SSE; the Swarm Editor header must carry the "Simulated preview" badge so
 *    fabricated execution is never shown as real.
 *
 * Seeds `ps_session` from `E2E_API_KEY`. Run: `npm run test:e2e:prod`.
 */
import { test, expect, type Page } from '@playwright/test';

const KEY = process.env.E2E_API_KEY ?? '';

async function seed(page: Page): Promise<void> {
  await page.addInitScript((k: string) => {
    try {
      localStorage.setItem('ps_session', JSON.stringify({ token: k, identifier: 'test@megabyte.space', createdAt: Date.now() }));
      localStorage.setItem('ps_feedback_dismissed', 'true');
    } catch { /* private mode */ }
  }, KEY);
}

test.describe('admin — network + honesty regression guards', () => {
  test.skip(!KEY, 'E2E_API_KEY not set');
  test.describe.configure({ retries: 2 });

  test('no admin request ever hits a double-/api/api/ path', async ({ page }) => {
    test.setTimeout(120000);
    const doubled: string[] = [];
    page.on('request', (req) => {
      const u = req.url();
      if (u.includes('/api/api/')) doubled.push(u);
    });
    await seed(page);

    // Best-effort visit each bug-prone route + let its on-load fetches fire. We
    // do NOT hard-assert each route renders (that's other specs' job + can be
    // cold-boot-flaky) — the ONLY assertion here is "no /api/api/ ever fired".
    const ROUTES = ['/admin/logs', '/admin/mcp', '/admin/social', '/admin/sites', '/admin/apps/instances'];
    let anyRendered = false;
    for (const r of ROUTES) {
      try {
        await page.goto(r, { waitUntil: 'load', timeout: 30000 });
        if (await page.locator('.admin-sidebar').first().isVisible().catch(() => false)) anyRendered = true;
        await page.waitForTimeout(1500); // let on-load fetches fire
      } catch { /* slow/unreachable route — still counts whatever requests fired */ }
    }
    // Trigger the logs-explorer search explicitly (its calls were the worst offenders).
    const searchBtn = page.getByRole('button', { name: /search/i }).first();
    if (await searchBtn.count().catch(() => 0)) { await searchBtn.click().catch(() => {}); await page.waitForTimeout(800); }

    expect(anyRendered, 'at least one admin route must have rendered to exercise the guard').toBe(true);
    expect(doubled, `Requests hit a double-/api path:\n${doubled.join('\n')}`).toEqual([]);
  });

  test('swarm editor is labelled a simulated preview (no fake "live" claim)', async ({ page }) => {
    test.setTimeout(60000);
    await seed(page);
    await page.goto('/admin/swarm/test-site', { waitUntil: 'load' });
    await expect(page.locator('.admin-sidebar').first()).toBeVisible({ timeout: 30000 });
    await expect(page.locator('.swarm-demo-badge')).toContainText(/simulated preview/i, { timeout: 15000 });
  });
});
