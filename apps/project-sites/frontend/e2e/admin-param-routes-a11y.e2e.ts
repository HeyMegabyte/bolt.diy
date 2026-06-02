/**
 * @module e2e/admin-param-routes-a11y
 *
 * WCAG 2.2 AA (axe-core) coverage for the parameterized `/admin/sites/:id/*`
 * sub-routes. admin-a11y.e2e.ts only scans TOP-LEVEL admin routes, so these
 * deep, data-bearing surfaces — several of which only began rendering real
 * authenticated data after the round 101-103 auth sweep — had zero a11y
 * coverage. site-detail's tabs are covered separately in
 * admin-site-detail-tabs.e2e.ts; this spec covers the sibling sub-routes:
 *   /admin/sites/:id/dna · /branches · /mcp-server · /copilot
 *
 * Same AxeBuilder config as admin-a11y (wcag2a/2aa/21aa/22aa; iframe + AG Grid
 * excluded as third-party). Fails on serious/critical only (actionable, not
 * noisy). Skips cleanly when the test token surfaces no site row.
 *
 * Seeds `ps_session` from `E2E_API_KEY`. Run:
 *   E2E_API_KEY=psk_test_… npx playwright test --config=playwright.prod.config.ts admin-param-routes-a11y
 */
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const KEY = process.env.E2E_API_KEY ?? '';

async function seed(page: Page): Promise<void> {
  await page.addInitScript((k: string) => {
    try {
      localStorage.setItem(
        'ps_session',
        JSON.stringify({ token: k, identifier: 'test@megabyte.space', createdAt: Date.now() }),
      );
      localStorage.setItem('ps_feedback_dismissed', 'true');
    } catch { /* private mode */ }
  }, KEY);
}

const SUB_ROUTES = ['dna', 'branches', 'mcp-server', 'copilot'];

test.describe('admin — /admin/sites/:id/* param-route a11y (axe-core)', () => {
  test.skip(!KEY, 'E2E_API_KEY not set');
  test.describe.configure({ retries: 2 });

  test('every sites/:id sub-route is axe-clean (no serious/critical)', async ({ page }) => {
    test.setTimeout(150000);
    await seed(page);
    await page.goto('/admin/sites', { waitUntil: 'load' });
    await expect(page.locator('.admin-sidebar').first()).toBeVisible({ timeout: 30000 });

    const siteLink = page.locator('a[href^="/admin/sites/"]').first();
    await siteLink.waitFor({ state: 'visible', timeout: 15000 }).catch(() => { /* may be empty */ });
    if ((await siteLink.count()) === 0) {
      test.skip(true, 'No site rows from the test token — param-route a11y needs a real site id.');
      return;
    }
    const id = ((await siteLink.getAttribute('href')) ?? '').match(/\/admin\/sites\/([^/]+)/)?.[1];
    if (!id) {
      test.skip(true, 'Could not parse a site id from the site-list href.');
      return;
    }

    const blocking: string[] = [];
    for (const sub of SUB_ROUTES) {
      const route = `/admin/sites/${id}/${sub}`;
      await page.goto(route, { waitUntil: 'load' });
      await expect(page.locator('.admin-sidebar').first()).toBeVisible({ timeout: 30000 });
      await page.waitForTimeout(900); // settle authenticated fetch + render
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .exclude('iframe')
        .exclude('.ag-root')
        .analyze();
      for (const v of results.violations) {
        if (v.impact === 'serious' || v.impact === 'critical') {
          blocking.push(`[${route}] ${v.impact} · ${v.id} · ${v.nodes.length}× · ${v.nodes[0]?.target?.join(' ') ?? ''}`);
        }
      }
    }
    expect(blocking, `param-route axe violations:\n${blocking.join('\n')}`).toEqual([]);
  });
});
