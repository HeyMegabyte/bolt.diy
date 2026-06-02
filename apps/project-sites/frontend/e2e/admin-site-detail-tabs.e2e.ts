/**
 * @module e2e/admin-site-detail-tabs
 *
 * Console-hygiene + crash guard for site-detail's four tabs, which only became
 * data-bearing once site-detail authenticated (round 103 — d2a34dff). Before
 * that the tabs sent no Bearer, so the worker returned empty/401 and the
 * render paths were never exercised with real response shapes. Now they fetch
 * authenticated data (logs tail, snapshots, SQL console, integrations), so a
 * null field or unexpected row shape could throw at render time.
 *
 * This spec navigates to a real site (via the /admin/sites list) and clicks
 * through all four tabs, asserting:
 *   - each tab's panel becomes visible (no dead tab)
 *   - zero uncaught pageerror fires
 *   - zero console.error fires (benign third-party noise allow-listed)
 *
 * Skips cleanly when the test token surfaces no site row.
 *
 * Seeds `ps_session` from `E2E_API_KEY`. Run:
 *   E2E_API_KEY=psk_test_… npx playwright test --config=playwright.prod.config.ts admin-site-detail-tabs
 */
import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';

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

// Third-party / environmental console noise that isn't our bug. Notably the
// bolt.diy editor iframe (editor.projectsites.dev) is mounted persistently in
// the admin shell by BoltEmbedService and emits its own React/react-toastify
// errors on EVERY admin page — that's upstream bolt noise, orthogonal to the
// site-detail tabs this spec guards, so it's allow-listed by origin.
const BENIGN = [
  /editor\.projectsites\.dev/i, // bolt.diy editor iframe — upstream, not our code
  /react-toastify/i,
  /google\.com\/s2\/favicons/i,
  /posthog/i,
  /ResizeObserver loop/i,
  /Failed to load resource/i, // network 4xx/5xx are surfaced as toasts, not our JS errors
  /\[telemetry\]/i,
  /sentry/i,
];

const TABS: { id: string; panel: string; label: string }[] = [
  { id: '#sd-tab-logs', panel: '[data-testid="site-logs-panel"]', label: 'Logs' },
  { id: '#sd-tab-snapshots', panel: '[data-testid="site-snapshots-panel"]', label: 'Snapshots' },
  { id: '#sd-tab-sql', panel: '[data-testid="site-sql-panel"]', label: 'SQL' },
  { id: '#sd-tab-integrations', panel: '#sd-panel-integrations', label: 'Integrations' },
];

test.describe('admin — site-detail tabs are console-clean with real data (round 103)', () => {
  test.skip(!KEY, 'E2E_API_KEY not set');
  test.describe.configure({ retries: 2 });

  test('all four tabs render + no console.error / pageerror across them', async ({ page }) => {
    test.setTimeout(90000);

    const errors: string[] = [];
    const isBenign = (s: string) => BENIGN.some((re) => re.test(s));
    page.on('pageerror', (e) => {
      const blob = `${e.message}\n${e.stack ?? ''}`;
      if (isBenign(blob)) return; // bolt iframe / third-party
      errors.push(`pageerror: ${e.message}`);
    });
    page.on('console', (m: ConsoleMessage) => {
      if (m.type() !== 'error') return;
      const blob = `${m.text()}\n${m.location()?.url ?? ''}`;
      if (isBenign(blob)) return;
      errors.push(`console.error: ${m.text()}`);
    });

    await seed(page);
    await page.goto('/admin/sites', { waitUntil: 'load' });
    await expect(page.locator('.admin-sidebar').first()).toBeVisible({ timeout: 30000 });

    const siteLink = page.locator('a[href^="/admin/sites/"]').first();
    // The sites list loads async — wait for a row (or the empty-state) before deciding.
    await siteLink.waitFor({ state: 'visible', timeout: 15000 }).catch(() => { /* may be empty */ });
    if ((await siteLink.count()) === 0) {
      test.skip(true, 'No site rows from the test token — site-detail tabs need a real site id.');
      return;
    }
    const id = ((await siteLink.getAttribute('href')) ?? '').match(/\/admin\/sites\/([^/]+)/)?.[1];
    if (!id) {
      test.skip(true, 'Could not parse a site id from the site-list href.');
      return;
    }

    await page.goto(`/admin/sites/${id}`, { waitUntil: 'load' });
    await expect(page.locator('[data-testid="site-detail"]').first()).toBeVisible({ timeout: 30000 });

    for (const t of TABS) {
      await page.locator(t.id).click();
      await expect(page.locator(t.panel).first()).toBeVisible({ timeout: 15000 });
      await page.waitForTimeout(1200); // let the tab's authenticated fetch settle + render
    }

    expect(errors, `site-detail tabs threw console/page errors:\n${errors.join('\n')}`).toEqual([]);
  });
});
