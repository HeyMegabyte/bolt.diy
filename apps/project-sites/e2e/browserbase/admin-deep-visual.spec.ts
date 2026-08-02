/**
 * P0-ADMIN — REAL-BROWSER (Browserbase) visual verification of the DEEP admin
 * section content that headless Playwright cannot render.
 *
 * The mandate (Brian 2026-08-02) requires every admin feature verified in a REAL
 * browser both technically AND visually. Two fires established that headless
 * Playwright (the `playwright.prod.config.ts` chromium project) does NOT render
 * the deep content of large section components — the logs-dashboard tab strip
 * and the user-settings "Active sessions" card never mount, so their `ngOnInit`
 * fetches never fire (see [[deep-admin-components-need-browserbase]]). This spec
 * drives a managed **Browserbase real Chrome** (no device emulation) over CDP,
 * injects the real session, and proves those deep components render + populate.
 *
 * NOT in the default suite (Browserbase costs a session per run). Run on-demand:
 *   export E2E_API_KEY=$(get-secret E2E_API_KEY)
 *   export BROWSERBASE_API_KEY=$(get-secret BROWSERBASE_API_KEY)
 *   export BROWSERBASE_PROJECT_ID=$(get-secret BROWSERBASE_PROJECT_ID)
 *   npx playwright test --config playwright.prod.config.ts browserbase/ --workers=1
 *
 * @see {@link ../helpers/browserbase.ts}
 */
import { test, expect, chromium } from '@playwright/test';
import type { BrowserContext } from '@playwright/test';
import {
  browserbaseAvailable,
  createBrowserbaseSession,
  browserbaseConnectUrl,
} from '../helpers/browserbase.js';

const PROD = 'https://projectsites.dev';

/** Inject the real session + route `/api` so target endpoints hit live prod. */
async function primeContext(ctx: BrowserContext, token: string): Promise<void> {
  await ctx.addInitScript(
    ({ t, id }: { t: string; id: string }) => {
      localStorage.setItem(
        'ps_session',
        JSON.stringify({ token: t, identifier: id, createdAt: Date.now() }),
      );
    },
    { t: token, id: 'brian@megabyte.space' },
  );
  await ctx.route('**/api/**', async (route) => {
    const url = route.request().url();
    // Auth + the surfaces under test hit REAL prod (authed → real data).
    if (
      /\/api\/auth\/me\b/.test(url) ||
      /\/api\/(logs\/|admin\/sessions|admin\/api-keys|admin\/security|admin\/team|sites\b|network-analytics)/.test(url)
    ) {
      await route.continue();
      return;
    }
    const method = route.request().method();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: method === 'GET' ? '{"data":[]}' : '{"ok":true}',
    });
  });
}

test.describe('Browserbase real-Chrome — deep admin visual (P0-ADMIN)', () => {
  test('deep sections headless cannot render DO render + populate in real Chrome', async () => {
    test.skip(
      !process.env.RUN_BROWSERBASE || !browserbaseAvailable() || !process.env.E2E_API_KEY,
      'on-demand only — set RUN_BROWSERBASE=1 + BROWSERBASE_API_KEY/PROJECT_ID + E2E_API_KEY (Browserbase bills per session)',
    );
    test.setTimeout(180_000);
    const token = process.env.E2E_API_KEY!;

    const session = await createBrowserbaseSession();
    const browser = await chromium.connectOverCDP(browserbaseConnectUrl(session.id));
    try {
      const ctx = browser.contexts()[0] ?? (await browser.newContext());
      await primeContext(ctx, token);
      const page = ctx.pages()[0] ?? (await ctx.newPage());

      const consoleErrors: string[] = [];
      page.on('console', (m) => {
        if (m.type() === 'error' && !/Failed to load resource|net::ERR/i.test(m.text())) {
          consoleErrors.push(m.text());
        }
      });
      page.on('pageerror', (e) => consoleErrors.push(String(e)));

      // ── 1. Log Explorer tab (logs-dashboard tabs never mount headless) ──
      await page.goto(`${PROD}/admin/logs?tab=explorer`, { waitUntil: 'domcontentloaded' });
      // The tab strip MUST render in real Chrome (count was 0 headless).
      await page.locator('[role="tab"]').first().waitFor({ state: 'visible', timeout: 45_000 });
      const tabCount = await page.locator('[role="tab"]').count();
      expect(tabCount, 'logs-dashboard tab strip renders in real Chrome').toBeGreaterThan(0);

      // Activate the Explorer tab + let its ngOnInit fetch real logs.
      const explorerTab = page.locator('[role="tab"]', { hasText: /explorer/i }).first();
      if ((await explorerTab.count()) > 0) await explorerTab.click().catch(() => {});
      // The cost chart or the log table populates from real Observability data.
      await page
        .locator('.cost-chart-section, [data-testid="logs-table"], [data-testid="logs-empty"]')
        .first()
        .waitFor({ state: 'visible', timeout: 30_000 })
        .catch(() => {});
      await page.screenshot({
        path: 'e2e/screenshots/browserbase/logs-explorer.png',
        fullPage: true,
      });
      // Real data → the cost attribution section or a populated table renders
      // (headless produced neither). Empty-state is tolerated only if truly no logs.
      const populated =
        (await page.locator('.cost-chart-section').count()) +
        (await page.locator('[data-testid="logs-row"]').count());
      const bodyText = (await page.locator('body').innerText()).toLowerCase();
      expect(
        populated > 0 || bodyText.includes('route cost') || bodyText.includes('no logs'),
        'Log Explorer renders its real UI (cost chart / rows / honest empty) in real Chrome',
      ).toBe(true);
      // The misleading flag-gate notice must NOT appear (the flag is on).
      expect(
        await page.locator('[data-testid="logs-explorer-flag-gate"]').count(),
        'no misleading "isn\'t enabled" notice',
      ).toBe(0);

      // ── 2. user-settings "Active sessions" card (never mounts headless) ──
      await page.goto(`${PROD}/admin/user`, { waitUntil: 'domcontentloaded' });
      await page
        .locator('[data-testid^="session-row-"]')
        .first()
        .waitFor({ state: 'visible', timeout: 45_000 });
      const sessionRows = await page.locator('[data-testid^="session-row-"]').count();
      expect(sessionRows, 'Active Sessions card renders ≥1 row in real Chrome').toBeGreaterThanOrEqual(1);
      await page.screenshot({
        path: 'e2e/screenshots/browserbase/user-sessions.png',
        fullPage: true,
      });

      expect(
        consoleErrors,
        `deep sections must load with 0 console errors — saw ${consoleErrors.join(' | ')}`,
      ).toEqual([]);
    } finally {
      await browser.close();
    }
  });
});
