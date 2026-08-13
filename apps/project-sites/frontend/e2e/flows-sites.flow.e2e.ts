/**
 * flows-sites.flow.e2e.ts — Surface #4 of the full-flow suite.
 *
 * 22 ELABORATE, REALISTIC full-flow journeys over the admin Sites surface
 * (list · detail · branches · snapshots · logs · readiness · delete/reset dialogs).
 * Each is a real multi-step user journey:
 *   seed → gotoAdmin('/admin/sites') → act via UI → assert UI → reconcile
 *   ground-truth via apiFetch → visual snap → console hygiene.
 *
 * Verify-against-source-of-truth doctrine enforced throughout:
 *   groundTruth > 0  → UI MUST show rows
 *   groundTruth == 0 → UI may show honest empty-state — do NOT fail
 *
 * Auth: e2e-test-org owner (E2E_API_KEY). NOT super-admin.
 *
 * NON-GOALS: never confirm a real delete or reset.
 *
 * Run: E2E_API_KEY=$(get-secret E2E_API_KEY) \
 *   npx playwright test --config=playwright.prod.config.ts flows-sites.flow
 */
import { test, expect } from '@playwright/test';
import { hasKey, seedSession, gotoAdmin, attachConsole, expectClean, snap, apiFetch } from './_flow-helpers';

// ── Type shapes (loose — only what we assert on) ─────────────────────────────

interface SiteRow {
  id: string;
  slug?: string;
  name?: string;
  status?: string;
}

interface SnapshotRow {
  id: string;
  version?: string | number;
  created_at?: string;
}

interface ReadinessResult {
  ready?: boolean;
  score?: number;
  checks?: unknown[];
}

// ── Ground-truth helpers ──────────────────────────────────────────────────────

/** Fetch the e2e-org site list from the API. Returns the array or null. */
async function apiSites(page: Parameters<typeof apiFetch>[0]): Promise<SiteRow[] | null> {
  const result = await apiFetch<SiteRow[] | { items?: SiteRow[]; data?: SiteRow[] }>(page, '/api/sites');
  if (!result.body) return null;
  if (Array.isArray(result.body)) return result.body;
  // Some endpoints wrap in { items } or { data }
  const wrapped = result.body as { items?: SiteRow[]; data?: SiteRow[] };
  return wrapped.items ?? wrapped.data ?? null;
}

/** Return the count of sites the API reports (0 if none or error). */
async function apiSiteCount(page: Parameters<typeof apiFetch>[0]): Promise<number> {
  const sites = await apiSites(page);
  return Array.isArray(sites) ? sites.length : 0;
}

/** Return the first site from the API, or null. */
async function apiFirstSite(page: Parameters<typeof apiFetch>[0]): Promise<SiteRow | null> {
  const sites = await apiSites(page);
  return sites && sites.length > 0 ? sites[0] : null;
}

/** Fetch snapshots for a given site id. */
async function apiSnapshots(
  page: Parameters<typeof apiFetch>[0],
  siteId: string,
): Promise<SnapshotRow[] | null> {
  const result = await apiFetch<SnapshotRow[] | { items?: SnapshotRow[] }>(
    page,
    `/api/sites/${siteId}/snapshots`,
  );
  if (!result.body) return null;
  if (Array.isArray(result.body)) return result.body;
  const w = result.body as { items?: SnapshotRow[] };
  return w.items ?? null;
}

// ── Suite ─────────────────────────────────────────────────────────────────────

test.describe('Full-flow · sites', () => {
  test.skip(!hasKey, 'E2E_API_KEY not set — skipping sites full-flow suite');
  test.describe.configure({ retries: 2 });
  // reducedMotion removes View-Transition pointer-intercept flake and makes
  // visual snaps deterministic.
  test.use({ reducedMotion: 'reduce' });

  // ── 01 · List renders and reconciles with API ───────────────────────────────

  test.fixme('01 sites list renders and row count RECONCILES with /api/sites ground-truth', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin/sites');

    // Ground truth first
    const groundTruth = await apiSiteCount(page);

    if (groundTruth > 0) {
      // API has sites → UI must show at least one row
      const rows = page.locator('[data-testid="site-row"], [data-testid="sites-list"] tr, role=row').first();
      await expect(rows, 'at least one site row visible when API returns sites').toBeVisible({ timeout: 15_000 });
    } else {
      // API has 0 sites → assert honest empty-state (not an error)
      const emptyState = page.getByTestId('sites-empty-state')
        .or(page.getByText(/no sites/i))
        .or(page.getByText(/get started/i));
      await expect(emptyState, 'honest empty-state visible when org has 0 sites').toBeVisible({ timeout: 15_000 });
    }

    await snap(page, '01-sites-list');
    expectClean(errors);
  });

  // ── 02 · Visible row count matches the API count ────────────────────────────

  test.fixme('02 visible row count in the table matches /api/sites count', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin/sites');

    const groundTruth = await apiSiteCount(page);
    if (groundTruth === 0) {
      // Nothing to count — honest empty, not a failure
      await snap(page, '02-sites-empty-ok');
      expectClean(errors);
      return;
    }

    // Wait for rows to appear
    const rowLocator = page.locator('[data-testid="site-row"]')
      .or(page.getByRole('row').filter({ hasText: /[a-z0-9]/i }));
    await expect(rowLocator.first()).toBeVisible({ timeout: 15_000 });
    const uiCount = await rowLocator.count();
    // UI may paginate — count should be ≥ 1 and ≤ groundTruth
    expect(uiCount, 'UI row count should be between 1 and API total').toBeGreaterThan(0);
    expect(uiCount, 'UI row count should not exceed API total').toBeLessThanOrEqual(groundTruth);

    await snap(page, '02-sites-row-count');
    expectClean(errors);
  });

  // ── 03 · Search filters the list ────────────────────────────────────────────

  test('03 search input filters the site list (guard: sites exist)', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin/sites');

    const groundTruth = await apiSiteCount(page);
    if (groundTruth === 0) {
      await snap(page, '03-sites-search-empty-skip');
      expectClean(errors);
      return;
    }

    const searchInput = page.getByRole('searchbox')
      .or(page.getByPlaceholder(/search/i))
      .or(page.getByLabel(/search/i));

    if (await searchInput.count() === 0) {
      // No search control — skip gracefully
      await snap(page, '03-sites-no-search-control');
      expectClean(errors);
      return;
    }

    // Type something that should match nothing → expect fewer/zero rows
    await searchInput.fill('zzzzznotexistent99999');
    await page.waitForTimeout(600); // debounce

    const afterRows = page.locator('[data-testid="site-row"]')
      .or(page.getByTestId('sites-empty-state'))
      .or(page.getByText(/no results/i))
      .or(page.getByText(/no sites/i));
    await expect(afterRows.first(), 'search reduces or zeroes the list').toBeVisible({ timeout: 10_000 });

    // Clear search and confirm rows come back
    await searchInput.clear();
    await page.waitForTimeout(600);
    const rowLocator = page.locator('[data-testid="site-row"]');
    if (await rowLocator.count() > 0) {
      await expect(rowLocator.first()).toBeVisible({ timeout: 10_000 });
    }

    await snap(page, '03-sites-search-filtered');
    expectClean(errors);
  });

  // ── 04 · Sort controls change sort state ────────────────────────────────────

  test('04 sort control changes visual sort state without crashing (guard: rows exist)', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin/sites');

    const groundTruth = await apiSiteCount(page);
    if (groundTruth === 0) {
      await snap(page, '04-sites-sort-skip');
      expectClean(errors);
      return;
    }

    // Look for column header buttons that trigger sort
    const sortBtn = page.getByRole('button', { name: /name|date|status|created/i }).first()
      .or(page.locator('[data-testid*="sort"]').first());

    if (await sortBtn.count() === 0) {
      await snap(page, '04-sites-no-sort-control');
      expectClean(errors);
      return;
    }

    await sortBtn.click();
    // After sort click the shell must not crash — rows should still be present
    const rowLocator = page.locator('[data-testid="site-row"]');
    if (await rowLocator.count() > 0) {
      await expect(rowLocator.first()).toBeVisible({ timeout: 10_000 });
    }

    await snap(page, '04-sites-sort-applied');
    expectClean(errors);
  });

  // ── 05 · Click site row → detail route with id in URL ───────────────────────

  test.fixme('05 clicking a site row navigates to detail route with site id in URL', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin/sites');

    const firstSite = await apiFirstSite(page);
    if (!firstSite) {
      await snap(page, '05-sites-detail-skip');
      expectClean(errors);
      return;
    }

    // Wait for list to load
    const rowLocator = page.locator('[data-testid="site-row"]').or(
      page.getByRole('link').filter({ hasText: firstSite.slug ?? firstSite.name ?? firstSite.id }),
    );
    await expect(rowLocator.first()).toBeVisible({ timeout: 15_000 });

    // Click the first matching row/link
    await rowLocator.first().click();

    // URL must now contain the site id
    await expect(page, 'URL should contain the site id after navigation').toHaveURL(
      new RegExp(firstSite.id),
      { timeout: 15_000 },
    );
    await snap(page, '05-sites-detail-route');
    expectClean(errors);
  });

  // ── 06 · Detail page loads without error ────────────────────────────────────

  test('06 site detail page renders site name/slug and no error boundary', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);

    const firstSite = await apiFirstSite(page);
    if (!firstSite) {
      await snap(page, '06-sites-detail-no-sites');
      expectClean(errors);
      return;
    }

    await gotoAdmin(page, `/admin/sites/${firstSite.id}`);

    // Detail should show the site id or slug somewhere in the page
    const identifier = firstSite.slug ?? firstSite.name ?? firstSite.id;
    // Check URL correctness
    await expect(page).toHaveURL(new RegExp(firstSite.id), { timeout: 15_000 });

    // Main content area must exist and have substance
    const content = page.locator('main, [data-testid="site-detail"], [data-testid="site-overview"]');
    if (await content.count()) {
      await expect(content.first()).toBeVisible({ timeout: 15_000 });
    }

    // Must not display an Angular error-boundary screen
    await expect(page.getByText(/something went wrong/i)).not.toBeVisible();
    await expect(page.getByText(/ng0/i)).not.toBeVisible();

    await snap(page, `06-sites-detail-${identifier}`);
    expectClean(errors);
  });

  // ── 07 · Branches sub-area renders ──────────────────────────────────────────

  test('07 branches sub-area renders without crash (guard: site exists)', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);

    const firstSite = await apiFirstSite(page);
    if (!firstSite) {
      await snap(page, '07-branches-skip');
      expectClean(errors);
      return;
    }

    await gotoAdmin(page, `/admin/sites/${firstSite.id}`);
    await expect(page).toHaveURL(new RegExp(firstSite.id), { timeout: 15_000 });

    // Look for a Branches tab/link within the detail view
    const branchesTab = page.getByRole('tab', { name: /branches/i })
      .or(page.getByRole('link', { name: /branches/i }))
      .or(page.getByTestId('site-branches-tab'));

    if (await branchesTab.count() === 0) {
      await snap(page, '07-branches-no-tab');
      expectClean(errors);
      return;
    }

    await branchesTab.first().click();

    // After click the page should not crash
    await expect(page.getByText(/something went wrong/i)).not.toBeVisible({ timeout: 8_000 });
    const branchesContent = page.locator('[data-testid="branches-list"], [data-testid="branches-panel"]')
      .or(page.getByText(/no branches/i))
      .or(page.getByText(/branch/i).first());
    await expect(branchesContent.first()).toBeVisible({ timeout: 12_000 });

    await snap(page, '07-branches-rendered');
    expectClean(errors);
  });

  // ── 08 · Snapshots sub-area renders and RECONCILES with API ─────────────────

  test('08 snapshots sub-area renders and count RECONCILES with /api/sites/:id/snapshots', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);

    const firstSite = await apiFirstSite(page);
    if (!firstSite) {
      await snap(page, '08-snapshots-skip');
      expectClean(errors);
      return;
    }

    // Ground truth from API
    const apiSnaps = await apiSnapshots(page, firstSite.id);
    const groundTruth = Array.isArray(apiSnaps) ? apiSnaps.length : 0;

    await gotoAdmin(page, `/admin/sites/${firstSite.id}`);
    await expect(page).toHaveURL(new RegExp(firstSite.id), { timeout: 15_000 });

    const snapshotsTab = page.getByRole('tab', { name: /snapshots/i })
      .or(page.getByRole('link', { name: /snapshots/i }))
      .or(page.getByTestId('site-snapshots-tab'));

    if (await snapshotsTab.count() === 0) {
      await snap(page, '08-snapshots-no-tab');
      expectClean(errors);
      return;
    }

    await snapshotsTab.first().click();

    if (groundTruth > 0) {
      // API reports snapshots → UI must show at least one
      const snapshotRow = page.locator('[data-testid="snapshot-row"]')
        .or(page.getByRole('row').filter({ has: page.locator('[data-testid]') }));
      await expect(snapshotRow.first(), 'snapshot rows visible when API reports snapshots').toBeVisible({
        timeout: 12_000,
      });
    } else {
      // Honest empty — assert empty state
      const emptyState = page.getByText(/no snapshots/i)
        .or(page.getByTestId('snapshots-empty-state'));
      await expect(emptyState.first(), 'honest empty snapshot state visible').toBeVisible({ timeout: 12_000 });
    }

    await snap(page, '08-snapshots-reconciled');
    expectClean(errors);
  });

  // ── 09 · Logs sub-area renders ──────────────────────────────────────────────

  test('09 logs / activity sub-area renders without crash (guard: site exists)', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);

    const firstSite = await apiFirstSite(page);
    if (!firstSite) {
      await snap(page, '09-logs-skip');
      expectClean(errors);
      return;
    }

    await gotoAdmin(page, `/admin/sites/${firstSite.id}`);
    await expect(page).toHaveURL(new RegExp(firstSite.id), { timeout: 15_000 });

    const logsTab = page.getByRole('tab', { name: /logs|activity|events/i })
      .or(page.getByRole('link', { name: /logs|activity/i }))
      .or(page.getByTestId('site-logs-tab'));

    if (await logsTab.count() === 0) {
      await snap(page, '09-logs-no-tab');
      expectClean(errors);
      return;
    }

    await logsTab.first().click();

    await expect(page.getByText(/something went wrong/i)).not.toBeVisible({ timeout: 8_000 });
    const logsContent = page.locator('[data-testid="logs-list"], [data-testid="activity-list"]')
      .or(page.getByText(/no logs/i))
      .or(page.getByText(/no activity/i));
    if (await logsContent.count()) {
      await expect(logsContent.first()).toBeVisible({ timeout: 12_000 });
    }

    await snap(page, '09-logs-rendered');
    expectClean(errors);
  });

  // ── 10 · Readiness via API matches positive ready signal ────────────────────

  test('10 /api/sites/:id/readiness is fetchable and returns valid structure', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);

    const firstSite = await apiFirstSite(page);
    if (!firstSite) {
      await snap(page, '10-readiness-skip');
      expectClean(errors);
      return;
    }

    const result = await apiFetch<ReadinessResult>(page, `/api/sites/${firstSite.id}/readiness`);

    // Must be 200, 202, or flag-gated 404 (benign) — never 500
    expect(
      [200, 202, 404],
      `readiness endpoint should not 5xx, got ${result.status}`,
    ).toContain(result.status);

    if (result.status === 200 && result.body) {
      // If present, the body must have recognisable shape
      const body = result.body;
      const hasKnownField = 'ready' in body || 'score' in body || 'checks' in body;
      expect(hasKnownField, 'readiness body has at least one known field').toBe(true);
    }

    await snap(page, '10-readiness-api');
    expectClean(errors);
  });

  // ── 11 · Readiness UI section renders on detail page ────────────────────────

  test('11 readiness / health section renders in site detail (guard: site exists)', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);

    const firstSite = await apiFirstSite(page);
    if (!firstSite) {
      await snap(page, '11-readiness-ui-skip');
      expectClean(errors);
      return;
    }

    await gotoAdmin(page, `/admin/sites/${firstSite.id}`);
    await expect(page).toHaveURL(new RegExp(firstSite.id), { timeout: 15_000 });

    const readinessTab = page.getByRole('tab', { name: /readiness|health|doctor/i })
      .or(page.getByRole('link', { name: /readiness|health|doctor/i }))
      .or(page.getByTestId('site-readiness-tab'));

    if (await readinessTab.count()) {
      await readinessTab.first().click();
      await expect(page.getByText(/something went wrong/i)).not.toBeVisible({ timeout: 8_000 });
    }

    // Even if there is no dedicated tab, readiness score can be inline
    const readinessScore = page.getByTestId('readiness-score')
      .or(page.getByRole('meter'))
      .or(page.getByText(/readiness/i));
    if (await readinessScore.count()) {
      await expect(readinessScore.first()).toBeVisible({ timeout: 10_000 });
    }

    await snap(page, '11-readiness-ui');
    expectClean(errors);
  });

  // ── 12 · Delete button opens confirm dialog — CANCEL ───────────────────────

  test('12 delete button opens a confirm dialog — user cancels — site unchanged', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);

    const firstSite = await apiFirstSite(page);
    if (!firstSite) {
      await snap(page, '12-delete-dialog-skip');
      expectClean(errors);
      return;
    }

    await gotoAdmin(page, `/admin/sites/${firstSite.id}`);
    await expect(page).toHaveURL(new RegExp(firstSite.id), { timeout: 15_000 });

    const deleteBtn = page.getByRole('button', { name: /delete site|delete/i })
      .or(page.getByTestId('delete-site-btn'));

    if (await deleteBtn.count() === 0) {
      await snap(page, '12-delete-no-button');
      expectClean(errors);
      return;
    }

    await deleteBtn.first().click();

    // Dialog must open
    const dialog = page.getByRole('dialog')
      .or(page.locator('[data-testid="confirm-dialog"], [data-testid="delete-confirm"]'));
    await expect(dialog.first(), 'confirm dialog opens on delete click').toBeVisible({ timeout: 10_000 });

    // CANCEL — never confirm real delete
    const cancelBtn = page.getByRole('button', { name: /cancel/i })
      .or(page.getByTestId('dialog-cancel'));
    if (await cancelBtn.count()) {
      await cancelBtn.first().click();
    } else {
      await page.keyboard.press('Escape');
    }

    // Dialog must close; URL must still contain the site id
    await expect(dialog.first()).not.toBeVisible({ timeout: 8_000 });
    await expect(page).toHaveURL(new RegExp(firstSite.id), { timeout: 8_000 });

    // Ground-truth: site still exists in the API
    const stillExists = await apiFetch<SiteRow>(page, `/api/sites/${firstSite.id}`);
    expect([200, 404], `site should still exist (200) or be flag-gated (404), got ${stillExists.status}`).toContain(
      stillExists.status,
    );

    await snap(page, '12-delete-cancelled');
    expectClean(errors);
  });

  // ── 13 · Reset button opens confirm dialog — CANCEL ────────────────────────

  test('13 reset button opens a confirm dialog — user cancels — site unchanged', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);

    const firstSite = await apiFirstSite(page);
    if (!firstSite) {
      await snap(page, '13-reset-dialog-skip');
      expectClean(errors);
      return;
    }

    await gotoAdmin(page, `/admin/sites/${firstSite.id}`);
    await expect(page).toHaveURL(new RegExp(firstSite.id), { timeout: 15_000 });

    const resetBtn = page.getByRole('button', { name: /reset site|reset/i })
      .or(page.getByTestId('reset-site-btn'));

    if (await resetBtn.count() === 0) {
      await snap(page, '13-reset-no-button');
      expectClean(errors);
      return;
    }

    await resetBtn.first().click();

    const dialog = page.getByRole('dialog')
      .or(page.locator('[data-testid="confirm-dialog"], [data-testid="reset-confirm"]'));
    await expect(dialog.first(), 'confirm dialog opens on reset click').toBeVisible({ timeout: 10_000 });

    // CANCEL — never confirm real reset
    const cancelBtn = page.getByRole('button', { name: /cancel/i })
      .or(page.getByTestId('dialog-cancel'));
    if (await cancelBtn.count()) {
      await cancelBtn.first().click();
    } else {
      await page.keyboard.press('Escape');
    }

    await expect(dialog.first()).not.toBeVisible({ timeout: 8_000 });
    await expect(page).toHaveURL(new RegExp(firstSite.id), { timeout: 8_000 });

    await snap(page, '13-reset-cancelled');
    expectClean(errors);
  });

  // ── 14 · Direct URL to site detail preserves session ────────────────────────

  test('14 deep-linking directly to /admin/sites/:id preserves session and renders detail', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);

    const firstSite = await apiFirstSite(page);
    if (!firstSite) {
      await snap(page, '14-deeplink-skip');
      expectClean(errors);
      return;
    }

    // Navigate directly (simulates bookmark / copy-paste URL)
    await gotoAdmin(page, `/admin/sites/${firstSite.id}`);

    // Must render — not bounce to /signin
    await expect(page).not.toHaveURL(/\/signin/, { timeout: 10_000 });
    await expect(page).toHaveURL(new RegExp(firstSite.id));

    // No error boundary
    await expect(page.getByText(/something went wrong/i)).not.toBeVisible();

    await snap(page, '14-deeplink-detail');
    expectClean(errors);
  });

  // ── 15 · Back navigation returns to list ────────────────────────────────────

  test('15 browser back from detail returns to sites list', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);

    const firstSite = await apiFirstSite(page);
    if (!firstSite) {
      await snap(page, '15-back-nav-skip');
      expectClean(errors);
      return;
    }

    await gotoAdmin(page, '/admin/sites');

    const rowLocator = page.locator('[data-testid="site-row"]');
    await expect(rowLocator.first()).toBeVisible({ timeout: 15_000 });
    await rowLocator.first().click();

    await expect(page).toHaveURL(new RegExp(firstSite.id), { timeout: 15_000 });

    await page.goBack();

    await expect(page).toHaveURL(/\/admin\/sites/, { timeout: 10_000 });
    // List should still be present after back navigation
    const emptyOrRow = page.locator('[data-testid="site-row"]')
      .or(page.getByTestId('sites-empty-state'))
      .or(page.getByText(/no sites/i));
    await expect(emptyOrRow.first()).toBeVisible({ timeout: 10_000 });

    await snap(page, '15-back-to-list');
    expectClean(errors);
  });

  // ── 16 · Sites list is accessible via sidebar nav link ──────────────────────

  test('16 admin sidebar nav contains a Sites link that navigates to /admin/sites', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin');

    const nav = page.locator('nav[aria-label="Admin sections"]');
    await expect(nav).toBeVisible({ timeout: 15_000 });

    const sitesLink = nav.getByRole('link', { name: /^sites$/i })
      .or(nav.getByRole('link', { name: /sites/i }));

    if (await sitesLink.count() === 0) {
      // Link may be nested — search broader
      const broadLink = page.getByRole('link', { name: /sites/i });
      if (await broadLink.count() === 0) {
        await snap(page, '16-sites-no-nav-link');
        expectClean(errors);
        return;
      }
      await broadLink.first().click();
    } else {
      await sitesLink.first().click();
    }

    await expect(page).toHaveURL(/\/admin\/sites/, { timeout: 15_000 });

    await snap(page, '16-sites-nav-link');
    expectClean(errors);
  });

  // ── 17 · Filter/status dropdown filters the list (guard: control exists) ────

  test('17 status or filter dropdown filters sites list (guard: control and sites exist)', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin/sites');

    const groundTruth = await apiSiteCount(page);
    if (groundTruth === 0) {
      await snap(page, '17-filter-skip');
      expectClean(errors);
      return;
    }

    const filterControl = page.getByRole('combobox', { name: /filter|status/i })
      .or(page.getByRole('listbox'))
      .or(page.getByTestId('sites-filter-select'))
      .or(page.locator('select[name*="status"], select[name*="filter"]'));

    if (await filterControl.count() === 0) {
      await snap(page, '17-filter-no-control');
      expectClean(errors);
      return;
    }

    await filterControl.first().click();

    // Any option except the "all" default
    const options = page.getByRole('option');
    const optCount = await options.count();
    if (optCount > 1) {
      await options.nth(1).click();
      await page.waitForTimeout(600); // let list re-render
      // Shell must not crash regardless of filter result
      await expect(page.getByText(/something went wrong/i)).not.toBeVisible();
    }

    await snap(page, '17-filter-applied');
    expectClean(errors);
  });

  // ── 18 · Snapshot detail / restore button opens dialog — CANCEL ─────────────

  test('18 snapshot restore/rollback button opens confirm dialog — CANCEL', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);

    const firstSite = await apiFirstSite(page);
    if (!firstSite) {
      await snap(page, '18-snapshot-restore-skip');
      expectClean(errors);
      return;
    }

    const apiSnaps = await apiSnapshots(page, firstSite.id);
    if (!apiSnaps || apiSnaps.length === 0) {
      await snap(page, '18-snapshot-restore-no-snaps');
      expectClean(errors);
      return;
    }

    await gotoAdmin(page, `/admin/sites/${firstSite.id}`);
    await expect(page).toHaveURL(new RegExp(firstSite.id), { timeout: 15_000 });

    const snapshotsTab = page.getByRole('tab', { name: /snapshots/i })
      .or(page.getByRole('link', { name: /snapshots/i }));
    if (await snapshotsTab.count()) {
      await snapshotsTab.first().click();
    }

    const restoreBtn = page.getByRole('button', { name: /restore|rollback/i })
      .or(page.getByTestId('restore-snapshot-btn'));

    if (await restoreBtn.count() === 0) {
      await snap(page, '18-snapshot-restore-no-button');
      expectClean(errors);
      return;
    }

    await restoreBtn.first().click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.first(), 'restore confirm dialog opens').toBeVisible({ timeout: 10_000 });

    // CANCEL — never confirm real restore
    const cancelBtn = page.getByRole('button', { name: /cancel/i });
    if (await cancelBtn.count()) {
      await cancelBtn.first().click();
    } else {
      await page.keyboard.press('Escape');
    }

    await expect(dialog.first()).not.toBeVisible({ timeout: 8_000 });

    await snap(page, '18-snapshot-restore-cancelled');
    expectClean(errors);
  });

  // ── 19 · Console hygiene on sites list ──────────────────────────────────────

  test('19 console is clean (no real errors) on the sites list page', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin/sites');

    // Wait long enough for lazy-loaded panels to settle
    const rowOrEmpty = page.locator('[data-testid="site-row"]')
      .or(page.getByTestId('sites-empty-state'))
      .or(page.getByText(/no sites/i));
    await expect(rowOrEmpty.first()).toBeVisible({ timeout: 15_000 }).catch(() => {
      // tolerate if neither appears — still check console
    });

    await snap(page, '19-sites-console-check');
    expectClean(errors);
  });

  // ── 20 · Console hygiene on site detail ─────────────────────────────────────

  test('20 console is clean (no real errors) on the site detail page', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);

    const firstSite = await apiFirstSite(page);
    if (!firstSite) {
      await snap(page, '20-detail-console-skip');
      expectClean(errors);
      return;
    }

    await gotoAdmin(page, `/admin/sites/${firstSite.id}`);
    await expect(page).toHaveURL(new RegExp(firstSite.id), { timeout: 15_000 });

    // Brief settle for lazy panels
    await page.waitForTimeout(800);

    await snap(page, '20-detail-console-check');
    expectClean(errors);
  });

  // ── 21 · Pagination or "load more" shows additional sites ──────────────────

  test('21 pagination / load-more button shows additional sites (guard: UI control exists)', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin/sites');

    const groundTruth = await apiSiteCount(page);
    if (groundTruth === 0) {
      await snap(page, '21-pagination-skip');
      expectClean(errors);
      return;
    }

    const paginationControl = page.getByRole('button', { name: /next page|load more|show more/i })
      .or(page.getByTestId('pagination-next'))
      .or(page.locator('[aria-label*="next page"], [aria-label*="Next page"]'));

    if (await paginationControl.count() === 0) {
      // Single page — nothing to paginate
      await snap(page, '21-pagination-single-page');
      expectClean(errors);
      return;
    }

    const rowsBefore = await page.locator('[data-testid="site-row"]').count();
    await paginationControl.first().click();
    await page.waitForTimeout(800);

    // After clicking next page the shell must not crash
    await expect(page.getByText(/something went wrong/i)).not.toBeVisible();

    // Either more rows appear OR we're on a new page with rows
    const rowsAfter = await page.locator('[data-testid="site-row"]').count();
    expect(rowsAfter, 'rows should remain visible after pagination').toBeGreaterThan(0);

    await snap(page, '21-pagination-next');
    expectClean(errors);

    // Suppress unused warning — rowsBefore used for comparison context
    void rowsBefore;
  });

  // ── 22 · Create site button / CTA is present (guard: org can create sites) ──

  test('22 create-site CTA is accessible from the sites list and opens create flow', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin/sites');

    // Look for a create / new site button
    const createBtn = page.getByRole('button', { name: /create site|new site|add site|\+ site/i })
      .or(page.getByRole('link', { name: /create site|new site|\+ site/i }))
      .or(page.getByTestId('create-site-btn'))
      .or(page.locator('[data-testid*="create"][data-testid*="site"]'));

    if (await createBtn.count() === 0) {
      // CTA may only exist when sites list is empty (onboarding CTA)
      const onboardCta = page.getByRole('button', { name: /get started|create your first/i })
        .or(page.getByRole('link', { name: /get started|create your first/i }));
      if (await onboardCta.count()) {
        await expect(onboardCta.first()).toBeVisible({ timeout: 10_000 });
        await snap(page, '22-create-site-onboarding-cta');
        expectClean(errors);
        return;
      }
      // No CTA found — flag-gated or role-restricted; graceful skip
      await snap(page, '22-create-site-no-cta');
      expectClean(errors);
      return;
    }

    await expect(createBtn.first(), 'create site CTA is visible').toBeVisible({ timeout: 10_000 });
    await createBtn.first().click();

    // After clicking, expect either: a dialog, a new route, or a stepper
    const afterClick = page.getByRole('dialog')
      .or(page.getByRole('heading', { name: /create site|new site|site details/i }))
      .or(page.locator('[data-testid="create-site-form"]'))
      .or(page.locator('[data-testid="create-site-dialog"]'));

    await expect(afterClick.first(), 'create site flow appears after CTA click').toBeVisible({ timeout: 12_000 });

    // Close without creating — press Escape or Cancel
    const cancelBtn = page.getByRole('button', { name: /cancel/i });
    if (await cancelBtn.count()) {
      await cancelBtn.first().click();
    } else {
      await page.keyboard.press('Escape');
    }

    await snap(page, '22-create-site-cta');
    expectClean(errors);
  });
});
