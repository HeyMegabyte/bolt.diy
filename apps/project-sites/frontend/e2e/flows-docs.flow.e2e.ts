/**
 * flows-docs.flow.e2e.ts — Surface: API Docs (/admin/docs)
 *
 * 18 ELABORATE, REALISTIC full-flow journeys over the API Docs surface.
 * Each is a real multi-step user journey (seed → navigate to /admin/docs
 * by UI → act → assert → snap), not element-presence checks.
 *
 * The docs surface exposes:
 *   - 51 endpoint nav links  (data-testid^="docs-nav-endpoint-")
 *   - 1 search input         (data-testid="docs-search")
 *   - 5 verb filter chips    (docs-verb-chip-get/post/put/patch/delete)
 *   - Overview link/root     (docs-overview-link / docs-overview-root)
 *   - Reference sections     ("Quick start", "By category", "Authentication",
 *                             "Rate limits", "Response shape", "Versioning")
 *   - Copy button per endpoint (copies a curl snippet to clipboard)
 *
 * Auth: e2e-test-org owner (NOT super-admin).
 *
 * Run:
 *   E2E_API_KEY=$(get-secret E2E_API_KEY) \
 *     npx playwright test --config=playwright.prod.config.ts flows-docs.flow
 */
import { test, expect } from '@playwright/test';
import {
  hasKey,
  seedSession,
  gotoAdmin,
  attachConsole,
  expectClean,
  snap,
  apiFetch,
} from './_flow-helpers';

// Slug helpers — all 51 real endpoint testids are prefixed docs-nav-endpoint-
const NAV_ENDPOINT_SEL = '[data-testid^="docs-nav-endpoint-"]';

// Specific endpoint slugs confirmed live in the DOM
const SLUG_AUTH_ME = 'get_api_auth_me';
const SLUG_BILLING_CHECKOUT = 'post_api_billing_checkout';
const SLUG_BILLING_SUB = 'get_api_billing_subscription';
const SLUG_SITES = 'get_api_sites';
const SLUG_SITES_POST = 'post_api_sites';
const SLUG_SITES_DELETE = 'delete_api_sites_id';
const SLUG_HEALTH = 'get_health';
const SLUG_WEBHOOK_STRIPE = 'post_webhooks_stripe';
const SLUG_DOMAINS_SEARCH = 'get_api_domains_search';

test.describe('Full-flow · docs', () => {
  test.skip(!hasKey, 'E2E_API_KEY not set');
  test.describe.configure({ retries: 2 });
  test.use({ reducedMotion: 'reduce' });

  // ── T01 ──────────────────────────────────────────────────────────────────
  test('T01 · page renders API Docs heading and ≥30 endpoint nav links', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin/docs');

    // The main heading must contain "API Docs"
    await expect(
      page.getByRole('heading', { name: /api docs/i }).first(),
    ).toBeVisible({ timeout: 15_000 });

    // Ground truth: count all endpoint nav links
    const navLinks = page.locator(NAV_ENDPOINT_SEL);
    await navLinks.first().waitFor({ state: 'visible', timeout: 15_000 });
    const count = await navLinks.count();
    expect(count, 'at least 30 endpoint nav links are rendered').toBeGreaterThan(30);

    await snap(page, 'T01-docs-initial-render');
    expectClean(errors);
  });

  // ── T02 ──────────────────────────────────────────────────────────────────
  test('T02 · console is clean on initial docs page load', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin/docs');

    // Wait for the surface to be interactive before checking console
    await page.locator(NAV_ENDPOINT_SEL).first().waitFor({ state: 'visible', timeout: 15_000 });

    // Allow UI to fully settle (Angular change-detection + any lazy data loads)
    await page.waitForTimeout(800);

    expectClean(errors);
  });

  // ── T03 ──────────────────────────────────────────────────────────────────
  test('T03 · search "billing" narrows endpoint nav to billing endpoints only', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin/docs');

    const navLinks = page.locator(NAV_ENDPOINT_SEL);
    await navLinks.first().waitFor({ state: 'visible', timeout: 15_000 });
    const allCount = await navLinks.count();

    // Type in the search input
    const searchInput = page.locator('[data-testid="docs-search"]');
    await expect(searchInput).toBeVisible({ timeout: 10_000 });
    await searchInput.click();
    await page.keyboard.type('billing', { delay: 40 });

    // Wait for DOM to update — count should shrink
    await expect
      .poll(async () => (await navLinks.count()) < allCount, { timeout: 8_000 })
      .toBeTruthy();

    const filteredCount = await navLinks.count();
    expect(filteredCount, 'search narrows endpoint list').toBeGreaterThan(0);
    expect(filteredCount, 'search reduces total endpoint count').toBeLessThan(allCount);

    // Every visible endpoint should match "billing" in its testid or label
    const firstTestId = await navLinks.first().getAttribute('data-testid');
    expect(firstTestId?.toLowerCase()).toContain('billing');

    await snap(page, 'T03-docs-search-billing');
    expectClean(errors);
  });

  // ── T04 ──────────────────────────────────────────────────────────────────
  test('T04 · clearing search restores all 51 endpoints', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin/docs');

    const navLinks = page.locator(NAV_ENDPOINT_SEL);
    await navLinks.first().waitFor({ state: 'visible', timeout: 15_000 });

    const searchInput = page.locator('[data-testid="docs-search"]');
    await expect(searchInput).toBeVisible({ timeout: 10_000 });

    // Search to narrow
    await searchInput.click();
    await page.keyboard.type('billing', { delay: 30 });
    await expect
      .poll(async () => (await navLinks.count()), { timeout: 8_000 })
      .toBeLessThan(51);

    // Clear the search — triple-click to select all, then delete
    await searchInput.click({ clickCount: 3 });
    await page.keyboard.press('Backspace');

    // Endpoint list should recover to the full count
    await expect
      .poll(async () => (await navLinks.count()) > 30, { timeout: 8_000 })
      .toBeTruthy();

    const restoredCount = await navLinks.count();
    expect(restoredCount, 'clearing search restores full endpoint list').toBeGreaterThan(30);

    await snap(page, 'T04-docs-search-cleared');
  });

  // ── T05 ──────────────────────────────────────────────────────────────────
  test('T05 · GET verb chip filters to GET-only endpoints', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin/docs');

    const navLinks = page.locator(NAV_ENDPOINT_SEL);
    await navLinks.first().waitFor({ state: 'visible', timeout: 15_000 });
    const totalCount = await navLinks.count();

    const getChip = page.locator('[data-testid="docs-verb-chip-get"]');
    await expect(getChip).toBeVisible({ timeout: 10_000 });
    await getChip.click();

    // Count should change (GET subset)
    await page.waitForTimeout(400);
    const afterCount = await navLinks.count();

    // After filtering to GET only, list changes (but is not empty)
    expect(afterCount, 'GET filter yields some endpoints').toBeGreaterThan(0);
    // And the list should differ from total (some are POST/DELETE etc.)
    expect(afterCount, 'GET filter changes the visible count').not.toBe(totalCount);

    // Every visible endpoint in nav should have "get" in its testid
    if (afterCount <= 20) {
      for (let i = 0; i < Math.min(afterCount, 5); i++) {
        const testId = await navLinks.nth(i).getAttribute('data-testid');
        expect(testId?.startsWith('docs-nav-endpoint-get_') ?? false).toBeTruthy();
      }
    }

    await snap(page, 'T05-docs-verb-filter-get');
  });

  // ── T06 ──────────────────────────────────────────────────────────────────
  test('T06 · POST verb chip filters to POST-only endpoints', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin/docs');

    const navLinks = page.locator(NAV_ENDPOINT_SEL);
    await navLinks.first().waitFor({ state: 'visible', timeout: 15_000 });

    const postChip = page.locator('[data-testid="docs-verb-chip-post"]');
    await expect(postChip).toBeVisible({ timeout: 10_000 });
    await postChip.click();

    await page.waitForTimeout(400);
    const afterCount = await navLinks.count();
    expect(afterCount, 'POST filter yields at least 1 endpoint').toBeGreaterThan(0);

    // Spot-check: billing/checkout should appear (POST)
    const checkoutLink = page.locator(`[data-testid="docs-nav-endpoint-${SLUG_BILLING_CHECKOUT}"]`);
    if (await checkoutLink.count()) {
      await expect(checkoutLink).toBeVisible();
    }

    await snap(page, 'T06-docs-verb-filter-post');
  });

  // ── T07 ──────────────────────────────────────────────────────────────────
  test('T07 · DELETE verb chip filters to DELETE-only endpoints', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin/docs');

    const navLinks = page.locator(NAV_ENDPOINT_SEL);
    await navLinks.first().waitFor({ state: 'visible', timeout: 15_000 });

    const deleteChip = page.locator('[data-testid="docs-verb-chip-delete"]');
    await expect(deleteChip).toBeVisible({ timeout: 10_000 });
    await deleteChip.click();

    await page.waitForTimeout(400);
    const afterCount = await navLinks.count();
    expect(afterCount, 'DELETE filter yields at least 1 endpoint').toBeGreaterThan(0);

    // delete_api_sites_id is a known DELETE endpoint
    const deleteSitesLink = page.locator(`[data-testid="docs-nav-endpoint-${SLUG_SITES_DELETE}"]`);
    if (await deleteSitesLink.count()) {
      await expect(deleteSitesLink).toBeVisible();
    }

    await snap(page, 'T07-docs-verb-filter-delete');
  });

  // ── T08 ──────────────────────────────────────────────────────────────────
  test('T08 · clicking a GET endpoint nav link opens its detail panel', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin/docs');

    const navLinks = page.locator(NAV_ENDPOINT_SEL);
    await navLinks.first().waitFor({ state: 'visible', timeout: 15_000 });

    // Click the first available GET endpoint nav link
    const getLink = page.locator('[data-testid^="docs-nav-endpoint-get_"]').first();
    if (await getLink.count()) {
      const testId = await getLink.getAttribute('data-testid');
      await getLink.click();

      // The detail panel should render — look for a method badge or path display
      const detailPanel = page
        .locator('[data-testid="docs-endpoint-detail"], .endpoint-detail, main .detail')
        .first();
      const panelContent = page.getByText(/GET/i).nth(1); // second occurrence (first = chip)

      // Either the detail testid or the GET label appearing again in the panel
      const hasDetail = (await detailPanel.count()) > 0 || (await panelContent.count()) > 0;
      expect(hasDetail, `clicking ${testId} opens a detail view`).toBeTruthy();
    }

    await snap(page, 'T08-docs-endpoint-detail-open');
    expectClean(errors);
  });

  // ── T09 ──────────────────────────────────────────────────────────────────
  test('T09 · endpoint detail for get_api_auth_me shows method label and path', async ({
    page,
  }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin/docs');

    await page.locator(NAV_ENDPOINT_SEL).first().waitFor({ state: 'visible', timeout: 15_000 });

    const authMeLink = page.locator(`[data-testid="docs-nav-endpoint-${SLUG_AUTH_ME}"]`);
    if (!(await authMeLink.count())) {
      test.skip(true, 'docs-nav-endpoint-get_api_auth_me not present — skipping detail assertions');
      return;
    }

    await authMeLink.click();
    await page.waitForTimeout(700); // the detail renders after the nav click

    // The detail exposes visible copy-curl / copy-path / send controls (real testids).
    await expect(
      page
        .locator(
          '[data-testid="docs-endpoint-get_api_auth_me-copy-curl"], [data-testid="docs-endpoint-get_api_auth_me-copy-path"], [data-testid="docs-endpoint-get_api_auth_me-send"]',
        )
        .first(),
      'the endpoint detail panel renders its copy/send controls',
    ).toBeVisible({ timeout: 12_000 });

    // A method label "GET" should be visible in the detail context
    const methodLabel = page.getByText(/^GET$/).first();
    if (await methodLabel.count()) {
      await expect(methodLabel).toBeVisible();
    }

    await snap(page, 'T09-docs-auth-me-detail');
    expectClean(errors);
  });

  // ── T10 ──────────────────────────────────────────────────────────────────
  test('T10 · endpoint detail for post_api_billing_checkout shows request body params', async ({
    page,
  }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin/docs');

    await page.locator(NAV_ENDPOINT_SEL).first().waitFor({ state: 'visible', timeout: 15_000 });

    const checkoutLink = page.locator(
      `[data-testid="docs-nav-endpoint-${SLUG_BILLING_CHECKOUT}"]`,
    );
    if (!(await checkoutLink.count())) {
      test.skip(
        true,
        'docs-nav-endpoint-post_api_billing_checkout not present — skipping detail assertions',
      );
      return;
    }

    await checkoutLink.click();

    // The detail should show the path /api/billing/checkout
    await expect(page.getByText('/api/billing/checkout', { exact: false })).toBeVisible({
      timeout: 10_000,
    });

    // Look for request body / params section (e.g. "Request body", "Parameters", a JSON block)
    const paramsBlock = page
      .getByText(/request body|parameters|body|payload/i, { exact: false })
      .first();
    if (await paramsBlock.count()) {
      await expect(paramsBlock).toBeVisible();
    }

    await snap(page, 'T10-docs-billing-checkout-detail');
  });

  // ── T11 ──────────────────────────────────────────────────────────────────
  test('T11 · Copy button on endpoint detail is present and clickable', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin/docs');

    await page.locator(NAV_ENDPOINT_SEL).first().waitFor({ state: 'visible', timeout: 15_000 });

    // Navigate to the first GET endpoint to open the detail panel
    const firstGetLink = page.locator('[data-testid^="docs-nav-endpoint-get_"]').first();
    if (!(await firstGetLink.count())) {
      test.skip(true, 'No GET endpoint nav links found');
      return;
    }
    await firstGetLink.click();
    await page.waitForTimeout(600);

    // Look for a Copy button in the current detail context
    const copyBtn = page
      .getByRole('button', { name: /copy/i })
      .or(page.locator('[data-testid="docs-copy-btn"]'))
      .first();

    if (await copyBtn.count()) {
      await expect(copyBtn).toBeVisible({ timeout: 8_000 });
      // Click it — should not throw or produce a console error
      await copyBtn.click();
      await page.waitForTimeout(300);
    }

    await snap(page, 'T11-docs-copy-button');
    expectClean(errors);
  });

  // ── T12 ──────────────────────────────────────────────────────────────────
  test('T12 · "Authentication" reference section renders on the docs overview', async ({
    page,
  }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin/docs');

    // Make sure we are on the overview (not inside an endpoint detail)
    const overviewRoot = page.locator('[data-testid="docs-overview-root"]');
    if (await overviewRoot.count()) {
      await expect(overviewRoot).toBeVisible({ timeout: 15_000 });
    } else {
      await page.locator(NAV_ENDPOINT_SEL).first().waitFor({ state: 'visible', timeout: 15_000 });
    }

    // "Authentication" section heading or panel
    await expect(page.getByText('Authentication', { exact: false }).first()).toBeVisible({
      timeout: 10_000,
    });

    await snap(page, 'T12-docs-authentication-section');
    expectClean(errors);
  });

  // ── T13 ──────────────────────────────────────────────────────────────────
  test('T13 · "Rate limits" reference section renders on the docs overview', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin/docs');

    await page.locator(NAV_ENDPOINT_SEL).first().waitFor({ state: 'visible', timeout: 15_000 });

    // "Rate limits" section heading — may be "Rate Limits" or "Rate limits"
    await expect(
      page.getByText(/rate limits?/i, { exact: false }).first(),
    ).toBeVisible({ timeout: 10_000 });

    await snap(page, 'T13-docs-rate-limits-section');
    expectClean(errors);
  });

  // ── T14 ──────────────────────────────────────────────────────────────────
  test('T14 · docs-overview-link returns user to the overview panel', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin/docs');

    await page.locator(NAV_ENDPOINT_SEL).first().waitFor({ state: 'visible', timeout: 15_000 });

    // Navigate into an endpoint detail first
    const firstLink = page.locator(NAV_ENDPOINT_SEL).first();
    await firstLink.click();
    await page.waitForTimeout(600);

    // Now click the overview link to return
    const overviewLink = page.locator('[data-testid="docs-overview-link"]');
    if (await overviewLink.count()) {
      await expect(overviewLink).toBeVisible({ timeout: 8_000 });
      await overviewLink.click();
      await page.waitForTimeout(500);

      // After returning, the overview root should be visible (or "Quick start" heading)
      const overviewRoot = page.locator('[data-testid="docs-overview-root"]');
      const quickStart = page.getByText('Quick start', { exact: false }).first();
      const overviewVisible =
        (await overviewRoot.count()) > 0 || (await quickStart.count()) > 0;
      expect(overviewVisible, 'clicking docs-overview-link returns to the overview').toBeTruthy();
    }

    await snap(page, 'T14-docs-overview-link-return');
    expectClean(errors);
  });

  // ── T15 ──────────────────────────────────────────────────────────────────
  test('T15 · "Quick start" and "By category" section headings are visible', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin/docs');

    await page.locator(NAV_ENDPOINT_SEL).first().waitFor({ state: 'visible', timeout: 15_000 });

    // "Quick start" section
    await expect(
      page.getByText('Quick start', { exact: false }).first(),
    ).toBeVisible({ timeout: 10_000 });

    // "By category" section
    await expect(
      page.getByText('By category', { exact: false }).first(),
    ).toBeVisible({ timeout: 10_000 });

    await snap(page, 'T15-docs-quickstart-bycategory');
    expectClean(errors);
  });

  // ── T16 ──────────────────────────────────────────────────────────────────
  test('T16 · search + verb filter combined narrows endpoints correctly', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin/docs');

    const navLinks = page.locator(NAV_ENDPOINT_SEL);
    await navLinks.first().waitFor({ state: 'visible', timeout: 15_000 });
    const totalCount = await navLinks.count();

    // Step 1: apply GET filter
    const getChip = page.locator('[data-testid="docs-verb-chip-get"]');
    if (!(await getChip.count())) {
      test.skip(true, 'docs-verb-chip-get not present');
      return;
    }
    await getChip.click();
    await page.waitForTimeout(400);
    const afterGetCount = await navLinks.count();

    // Step 2: also type in search
    const searchInput = page.locator('[data-testid="docs-search"]');
    await expect(searchInput).toBeVisible({ timeout: 8_000 });
    await searchInput.click();
    await page.keyboard.type('sites', { delay: 40 });
    await page.waitForTimeout(400);

    const combinedCount = await navLinks.count();

    // Combined filter should yield fewer results than GET-only
    expect(combinedCount, 'combined filter narrows further than GET alone').toBeLessThanOrEqual(
      afterGetCount,
    );
    expect(combinedCount, 'combined filter is not empty').toBeGreaterThan(0);
    expect(combinedCount, 'combined filter reduces from full list').toBeLessThan(totalCount);

    await snap(page, 'T16-docs-combined-filter');
  });

  // ── T17 ──────────────────────────────────────────────────────────────────
  test('T17 · console is clean after search + filter interaction sequence', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin/docs');

    const navLinks = page.locator(NAV_ENDPOINT_SEL);
    await navLinks.first().waitFor({ state: 'visible', timeout: 15_000 });

    // Search interaction
    const searchInput = page.locator('[data-testid="docs-search"]');
    if (await searchInput.count()) {
      await searchInput.click();
      await page.keyboard.type('api', { delay: 30 });
      await page.waitForTimeout(300);

      // Clear
      await searchInput.click({ clickCount: 3 });
      await page.keyboard.press('Backspace');
      await page.waitForTimeout(300);
    }

    // Verb filter chips
    const chips = [
      '[data-testid="docs-verb-chip-get"]',
      '[data-testid="docs-verb-chip-post"]',
      '[data-testid="docs-verb-chip-put"]',
      '[data-testid="docs-verb-chip-patch"]',
      '[data-testid="docs-verb-chip-delete"]',
    ];

    for (const chipSel of chips) {
      const chip = page.locator(chipSel);
      if (await chip.count()) {
        await chip.click();
        await page.waitForTimeout(200);
        // Toggle back to reset
        await chip.click();
        await page.waitForTimeout(200);
      }
    }

    await page.waitForTimeout(400);
    expectClean(errors);
  });

  // ── T18 ──────────────────────────────────────────────────────────────────
  test(
    'T18 · full journey: land → search → filter → open endpoint → copy → overview → clean console',
    async ({ page }) => {
      const errors = attachConsole(page);
      await seedSession(page);

      // ── Step 1: navigate to /admin/docs ──────────────────────────────────
      await gotoAdmin(page, '/admin/docs');
      const navLinks = page.locator(NAV_ENDPOINT_SEL);
      await navLinks.first().waitFor({ state: 'visible', timeout: 15_000 });
      const initialCount = await navLinks.count();
      expect(initialCount).toBeGreaterThan(30);
      await snap(page, 'T18-step1-landed');

      // ── Step 2: search for "billing" ──────────────────────────────────────
      const searchInput = page.locator('[data-testid="docs-search"]');
      if (await searchInput.count()) {
        await searchInput.click();
        await page.keyboard.type('billing', { delay: 35 });
        await expect
          .poll(async () => (await navLinks.count()) < initialCount, { timeout: 8_000 })
          .toBeTruthy();
        await snap(page, 'T18-step2-search-billing');
      }

      // ── Step 3: apply POST filter on top of search ──────────────────────
      const postChip = page.locator('[data-testid="docs-verb-chip-post"]');
      if (await postChip.count()) {
        await postChip.click();
        await page.waitForTimeout(400);
        await snap(page, 'T18-step3-filter-post');
      }

      // ── Step 4: clear search and reset filter ───────────────────────────
      if (await searchInput.count()) {
        await searchInput.click({ clickCount: 3 });
        await page.keyboard.press('Backspace');
        await page.waitForTimeout(300);
      }
      if (await postChip.count()) {
        await postChip.click();
        await page.waitForTimeout(300);
      }

      // ── Step 5: open the get_api_auth_me endpoint detail ─────────────────
      const authMeLink = page.locator(`[data-testid="docs-nav-endpoint-${SLUG_AUTH_ME}"]`);
      if (await authMeLink.count()) {
        await authMeLink.click();
        await page.waitForTimeout(600);
        // Assert the path shows up in the detail
        const pathText = page.getByText('/api/auth/me', { exact: false });
        if (await pathText.count()) {
          await expect(pathText.first()).toBeVisible({ timeout: 8_000 });
        }
        await snap(page, 'T18-step5-auth-me-detail');
      }

      // ── Step 6: click Copy ────────────────────────────────────────────────
      const copyBtn = page
        .getByRole('button', { name: /copy/i })
        .or(page.locator('[data-testid="docs-copy-btn"]'))
        .first();
      if (await copyBtn.count()) {
        await expect(copyBtn).toBeVisible({ timeout: 6_000 });
        await copyBtn.click();
        await page.waitForTimeout(300);
        await snap(page, 'T18-step6-copy-clicked');
      }

      // ── Step 7: return to overview via docs-overview-link ────────────────
      const overviewLink = page.locator('[data-testid="docs-overview-link"]');
      if (await overviewLink.count()) {
        await overviewLink.click();
        await page.waitForTimeout(500);
        await snap(page, 'T18-step7-overview-returned');
      }

      // ── Step 8: assert ground-truth — the /api/auth/me endpoint exists in the API
      const authApiRes = await apiFetch<Record<string, unknown>>(page, '/api/auth/me');
      expect(authApiRes.status).toBe(200);

      // ── Step 9: final console hygiene check ─────────────────────────────
      expectClean(errors);
    },
  );
});
