/**
 * @module e2e/admin-section-states
 *
 * Regression guard for round-1 fixes that lacked dedicated coverage:
 *
 *   1. site-mcp-server (`/admin/sites/:id/mcp-server`) — requires a real site
 *      ID so we navigate via /admin/sites first; the test is skipped with a
 *      clear reason when no site row is available from the test token.
 *
 *   2. apps-instances (`/admin/apps/instances`) — the round-1 fix added a
 *      distinct skeleton + error-card branch so a 401 never silently blanks
 *      the section. Asserts a valid 4-state container renders; never blank.
 *
 *   3. Broad smoke — 12 core admin routes are visited in a single test.
 *      For each route the test asserts:
 *        (a) `.admin-sidebar` is visible (shell alive)
 *        (b) a valid state container OR real content becomes visible within 20s
 *        (c) no uncaught page error fires (pageerror collector stays empty)
 *      Proving no route crashes or renders a blank void with the test token.
 *
 * Selector contract (4-state kit + common real-content markers):
 *   error-card   → `[data-testid="error-card"], app-error-card`
 *   skeleton     → `app-skeleton, [aria-busy="true"]`
 *   empty-state  → `app-empty-state, [data-testid="empty-state"]`
 *   real content → `table, .ff-card, .ps-table-wrap, h2, h3, [appreveal],
 *                   .section-h, [data-testid]`
 *
 * Seeds `ps_session` from `E2E_API_KEY`. Run:
 *   E2E_API_KEY=psk_test_… npx playwright test --config=playwright.prod.config.ts admin-section-states
 */
import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';

const KEY = process.env.E2E_API_KEY ?? '';

// --- helpers -----------------------------------------------------------------

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

/**
 * A section rendered a VALID 4-state container — error-card, skeleton,
 * empty-state, or real content.  Anything is fine; a blank page is not.
 */
const STATE_SELECTOR = [
  '[data-testid="error-card"]',
  'app-error-card',
  'app-skeleton',
  '[aria-busy="true"]',
  'app-empty-state',
  '[data-testid="empty-state"]',
  'table',
  '.ff-card',
  '.ps-table-wrap',
  '.section-h',
  '[data-testid="site-mcp-server"]',
  '[data-testid="apps-instances"]',
  '[data-testid="logs-dashboard"]',
  '[data-testid="sf-root"]',
  // broad fallback — any heading means the section painted something real
  'h1',
  'h2',
  'h3',
].join(', ');

/** Attach a console-error + pageerror collector. Returns the errors array. */
function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  const BENIGN = [
    /googletagmanager\.com/i,
    /google-analytics\.com/i,
    /posthog/i,
    /NG0911/i,
    /editor\.projectsites\.dev/i,
    /Failed to load resource/i,
  ];
  page.on('console', (m: ConsoleMessage) => {
    if (m.type() === 'error' && !BENIGN.some((re) => re.test(m.text()))) {
      errors.push(`[console.error] ${m.text()}`);
    }
  });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  return errors;
}

// --- tests -------------------------------------------------------------------

test.describe('admin — section-states round-1 coverage', () => {
  test.skip(!KEY, 'E2E_API_KEY not set');
  test.describe.configure({ retries: 2 });

  // ── 1. site-mcp-server ────────────────────────────────────────────────────
  test('site-mcp-server: navigate from /admin/sites → first site → mcp-server tab (or skip gracefully)', async ({ page }) => {
    test.setTimeout(60000);
    await seed(page);
    await page.goto('/admin/sites', { waitUntil: 'load' });
    await expect(page.locator('.admin-sidebar').first()).toBeVisible({ timeout: 30000 });

    // Try to find a clickable site row.  With a 401-token there may be none,
    // or the list may render an empty-state instead of rows.
    const siteLink = page.locator('a[href^="/admin/sites/"]').first();
    const hasSite = (await siteLink.count()) > 0;

    if (!hasSite) {
      // No site row is available from the test token — that is expected.
      // Verify the section itself is in a valid state, then bail.
      await expect(
        page.locator(STATE_SELECTOR).first(),
      ).toBeVisible({ timeout: 15000 });
      test.skip(
        true,
        'No site rows visible with the test token — /admin/sites/:id/mcp-server requires a real site ID. ' +
        'Section itself renders a valid state (not blank), so the base shell is healthy.',
      );
      return;
    }

    // Extract the site ID from the href: /admin/sites/<id>
    const href = (await siteLink.getAttribute('href')) ?? '';
    const idMatch = href.match(/\/admin\/sites\/([^/]+)/);
    if (!idMatch) {
      test.skip(true, 'Could not parse a site ID from site-list href — skipping mcp-server deep-link.');
      return;
    }
    const siteId = idMatch[1];
    const mcpRoute = `/admin/sites/${siteId}/mcp-server`;

    await page.goto(mcpRoute, { waitUntil: 'load' });
    await expect(page.locator('.admin-sidebar').first()).toBeVisible({ timeout: 30000 });

    // With the test token the API 401s — expect error-card or skeleton, not blank.
    await expect(
      page.locator('[data-testid="error-card"], app-error-card, app-skeleton, [data-testid="site-mcp-server"]').first(),
    ).toBeVisible({ timeout: 20000 });

    // The page must not be literally blank — some content text must exist.
    const bodyLen = await page.evaluate(() => (document.body.textContent ?? '').trim().length);
    expect(bodyLen, 'mcp-server page must render non-empty content').toBeGreaterThan(30);
  });

  // ── 2. apps-instances ─────────────────────────────────────────────────────
  test('apps-instances: renders skeleton/empty/error-card — never a silent blank', async ({ page }) => {
    test.setTimeout(60000);
    const errors = trackErrors(page);
    await seed(page);
    await page.goto('/admin/apps/instances', { waitUntil: 'load' });
    await expect(page.locator('.admin-sidebar').first()).toBeVisible({ timeout: 30000 });

    // The round-1 fix added a skeleton while loading + an error-card on 401.
    // Assert one of the 4-state containers is present.
    await expect(
      page.locator(
        '[data-testid="error-card"], app-error-card, app-skeleton, [aria-busy="true"], app-empty-state, ' +
        '[data-testid="empty-state"], [data-testid="apps-instances"], .instance-row, .instance-list',
      ).first(),
    ).toBeVisible({ timeout: 20000 });

    // Body must not be empty.
    const bodyLen = await page.evaluate(() => (document.body.textContent ?? '').trim().length);
    expect(bodyLen, 'apps-instances must render non-empty content').toBeGreaterThan(30);

    // No app-level console errors.
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('logs-explorer (log_explorer flag): honest disabled-state OR live UI — never a silent blank', async ({ page }) => {
    test.setTimeout(60000);
    const errors = trackErrors(page);
    await seed(page);
    await page.goto('/admin/logs', { waitUntil: 'load' });
    await expect(page.locator('.admin-sidebar').first()).toBeVisible({ timeout: 30000 });

    // The logs surface is now the UNIFIED tabbed dashboard (Audit Trail + Log
    // Explorer tabs — logs-dashboard.component, `?tab=audit|explorer`). The old
    // standalone log-explorer selectors (.search-bar / .empty-card / "Log Explorer
    // isn't enabled") are gone. The durable contract this test guards is unchanged:
    // /admin/logs must NEVER be a silent blank (the bug this round fixed: loadCosts
    // swallowed a 404 and left an empty page). Assert the dashboard shell renders.
    await expect(page.locator('[data-testid="logs-dashboard"]')).toBeVisible({ timeout: 20000 });

    const bodyLen = await page.evaluate(() => (document.body.textContent ?? '').trim().length);
    expect(bodyLen, 'logs-explorer must render non-empty content').toBeGreaterThan(30);
    expect(errors, errors.join('\n')).toEqual([]);
  });

  // ── 3. Broad smoke — 12 core admin routes ─────────────────────────────────
  test('smoke — 12 core admin routes: sidebar alive + valid state + no pageerror', async ({ page }) => {
    test.setTimeout(180_000);

    // Real owner-facing content sections that render a section container for the
    // non-super-admin E2E token. Deliberately EXCLUDED (they can't render a section
    // container for this token, so they belong in dedicated specs, not this smoke):
    //   • /admin/feature-flags — operator-only; sysAdminGuard redirects a
    //     non-super-admin to /admin/site-features.
    //   • /admin/seo — redirects to /admin/site-features (redundant with it).
    const ROUTES: string[] = [
      '/admin/sites',
      '/admin/analytics',
      '/admin/billing',
      '/admin/audit',
      '/admin/snapshots',
      '/admin/domains',
      '/admin/forms',
      '/admin/voice',
      '/admin/settings',
      '/admin/user',
      '/admin/logs',
      '/admin/site-features',
    ];

    // Self-diagnosing: collect EVERY failing route (not just the first) so a
    // regression names the exact section(s) rather than an opaque timeout.
    const failures: string[] = [];
    for (const route of ROUTES) {
      const pageErrors: string[] = [];
      page.once('pageerror', (e) => pageErrors.push(e.message));

      await seed(page);
      await page.goto(route, { waitUntil: 'load' });

      // (a) Sidebar must be alive.
      const sidebarOk = await page
        .locator('.admin-sidebar')
        .first()
        .waitFor({ state: 'visible', timeout: 30000 })
        .then(() => true)
        .catch(() => false);
      if (!sidebarOk) {
        failures.push(`${route}: sidebar never visible`);
        continue;
      }

      // (b) A valid state container OR real heading must appear within 20s.
      const stateOk = await page
        .locator(STATE_SELECTOR)
        .first()
        .waitFor({ state: 'visible', timeout: 20000 })
        .then(() => true)
        .catch(() => false);
      if (!stateOk) {
        failures.push(`${route}: no valid state container rendered`);
        continue;
      }

      // (c) No pageerror.
      if (pageErrors.length) failures.push(`${route}: pageerror — ${pageErrors.join('; ')}`);
    }

    expect(failures, `smoke failures:\n${failures.join('\n')}`).toEqual([]);
  });
});
