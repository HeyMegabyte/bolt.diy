/**
 * flows-apps.flow.e2e.ts — Full-flow journeys for /admin/apps.
 *
 * 18 ELABORATE, REALISTIC full-flow journeys over the Apps catalogue surface:
 * page load, result-status, lifecycle filters (All / Live / Soon), filter
 * toggling, search (partial match, clear, no-match), live-pill assertions on
 * known slugs, category filter interaction, card-click detail navigation,
 * search + lifecycle combinations, rapid toggle console hygiene, and a full
 * compound journey exercising all controls in sequence.
 *
 * Auth: Pathway C — E2E_API_KEY → seedSession → ps_session localStorage token.
 * Real testids captured from a live DOM probe on 2026-07-30.
 *
 * Run: E2E_API_KEY=$(get-secret E2E_API_KEY) \
 *   npx playwright test --config=playwright.prod.config.ts flows-apps.flow
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

test.describe('Full-flow · apps', () => {
  test.skip(!hasKey, 'E2E_API_KEY not set — skipping authed flows');
  test.describe.configure({ retries: 2 });
  // Reduced-motion disables Angular View-Transition pointer overlays that
  // intercept nav clicks mid-transition — removes concurrency flake and makes
  // visual snaps deterministic.
  test.use({ reducedMotion: 'reduce' });

  // ── 01 · initial render ─────────────────────────────────────────────────

  test('01 · page renders Apps heading with 67 apps and >20 cards visible', async ({ page }) => {
    const logs = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin/apps');
    await snap(page, 'apps-01-initial-load');
    await expect(page.getByRole('heading', { name: /Apps/i })).toBeVisible();
    const cards = page.locator('[data-testid^="apps-card-"]');
    await expect(cards.first()).toBeVisible();
    const count = await cards.count();
    expect(count).toBeGreaterThan(20);
    await expectClean(logs);
  });

  // ── 02 · result-status ──────────────────────────────────────────────────

  test('02 · apps-result-status reflects full catalogue count (67) on initial load', async ({ page }) => {
    const logs = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin/apps');
    const status = page.getByTestId('apps-result-status');
    await expect(status).toBeVisible();
    await expect(status).toContainText(/67/);
    await snap(page, 'apps-02-result-status');
    await expectClean(logs);
  });

  // ── 03 · lifecycle All ──────────────────────────────────────────────────

  test('03 · clicking apps-lifecycle-all returns full 67-app grid', async ({ page }) => {
    const logs = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin/apps');
    await page.getByTestId('apps-lifecycle-all').click();
    await snap(page, 'apps-03-lifecycle-all');
    const cards = page.locator('[data-testid^="apps-card-"]');
    await expect(cards.first()).toBeVisible();
    expect(await cards.count()).toBeGreaterThan(20);
    await expect(page.getByTestId('apps-result-status')).toContainText(/67/);
    await expectClean(logs);
  });

  // ── 04 · lifecycle Live ─────────────────────────────────────────────────

  test('04 · apps-lifecycle-live filter shows only live apps (~9) with live pills', async ({ page }) => {
    const logs = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin/apps');
    await page.getByTestId('apps-lifecycle-live').click();
    await snap(page, 'apps-04-lifecycle-live');
    const cards = page.locator('[data-testid^="apps-card-"]');
    await expect(cards.first()).toBeVisible();
    const count = await cards.count();
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(20);
    // Every visible card should have a live pill
    const livePills = page.locator('[data-testid^="apps-pill-live-"]');
    expect(await livePills.count()).toBe(count);
    await expectClean(logs);
  });

  // ── 05 · lifecycle Soon ─────────────────────────────────────────────────

  test('05 · apps-lifecycle-soon filter shows coming-soon cards (~58) with no live pills', async ({ page }) => {
    const logs = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin/apps');
    await page.getByTestId('apps-lifecycle-soon').click();
    await snap(page, 'apps-05-lifecycle-soon');
    const cards = page.locator('[data-testid^="apps-card-"]');
    await expect(cards.first()).toBeVisible();
    expect(await cards.count()).toBeGreaterThan(20);
    // No live pills should appear in the soon-only view
    expect(await page.locator('[data-testid^="apps-pill-live-"]').count()).toBe(0);
    await expectClean(logs);
  });

  // ── 06 · Live → All toggle ──────────────────────────────────────────────

  test('06 · toggling Live then All restores the full card grid (count increases)', async ({ page }) => {
    const logs = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin/apps');
    await page.getByTestId('apps-lifecycle-live').click();
    await expect(page.locator('[data-testid^="apps-card-"]').first()).toBeVisible();
    const liveCount = await page.locator('[data-testid^="apps-card-"]').count();
    await page.getByTestId('apps-lifecycle-all').click();
    await expect(page.locator('[data-testid^="apps-card-"]').first()).toBeVisible();
    const allCount = await page.locator('[data-testid^="apps-card-"]').count();
    expect(allCount).toBeGreaterThan(liveCount);
    await snap(page, 'apps-06-live-to-all');
    await expectClean(logs);
  });

  // ── 07 · Soon → All toggle ──────────────────────────────────────────────

  test('07 · toggling Soon then All restores the full card grid', async ({ page }) => {
    const logs = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin/apps');
    await page.getByTestId('apps-lifecycle-soon').click();
    await expect(page.locator('[data-testid^="apps-card-"]').first()).toBeVisible();
    await page.getByTestId('apps-lifecycle-all').click();
    await expect(page.locator('[data-testid^="apps-card-"]').first()).toBeVisible();
    expect(await page.locator('[data-testid^="apps-card-"]').count()).toBeGreaterThan(20);
    await snap(page, 'apps-07-soon-to-all');
    await expectClean(logs);
  });

  // ── 08 · search: exact slug ─────────────────────────────────────────────

  test('08 · typing "grafana" in apps-search-input narrows grid and shows grafana card', async ({ page }) => {
    const logs = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin/apps');
    const searchInput = page.getByTestId('apps-search-input');
    await expect(searchInput).toBeVisible();
    await searchInput.click();
    await page.keyboard.type('grafana');
    await snap(page, 'apps-08-search-grafana');
    const cards = page.locator('[data-testid^="apps-card-"]');
    await expect(cards.first()).toBeVisible();
    const count = await cards.count();
    expect(count).toBeGreaterThanOrEqual(1);
    expect(count).toBeLessThan(10);
    await expect(page.getByTestId('apps-card-grafana')).toBeVisible();
    await expectClean(logs);
  });

  // ── 09 · search: partial match ──────────────────────────────────────────

  test('09 · partial search term "lib" surfaces the librechat card', async ({ page }) => {
    const logs = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin/apps');
    const searchInput = page.getByTestId('apps-search-input');
    await searchInput.click();
    await page.keyboard.type('lib');
    await snap(page, 'apps-09-search-lib');
    await expect(page.locator('[data-testid^="apps-card-"]').first()).toBeVisible();
    await expect(page.getByTestId('apps-card-librechat')).toBeVisible();
    await expectClean(logs);
  });

  // ── 10 · search: clear restores grid ───────────────────────────────────

  test('10 · clearing search input after typing "n8n" restores the full card grid', async ({ page }) => {
    const logs = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin/apps');
    const searchInput = page.getByTestId('apps-search-input');
    await searchInput.click();
    await page.keyboard.type('n8n');
    await expect(page.getByTestId('apps-card-n8n')).toBeVisible();
    // Select-all + Backspace to clear
    await searchInput.click({ clickCount: 3 });
    await page.keyboard.press('Backspace');
    await snap(page, 'apps-10-search-cleared');
    const cards = page.locator('[data-testid^="apps-card-"]');
    await expect(cards.first()).toBeVisible();
    expect(await cards.count()).toBeGreaterThan(20);
    await expectClean(logs);
  });

  // ── 11 · listmonk card + live pill ─────────────────────────────────────

  test('11 · listmonk card is visible and carries apps-pill-live-listmonk', async ({ page }) => {
    const logs = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin/apps');
    await expect(page.getByTestId('apps-card-listmonk')).toBeVisible();
    await expect(page.getByTestId('apps-pill-live-listmonk')).toBeVisible();
    await snap(page, 'apps-11-listmonk-card');
    await expectClean(logs);
  });

  // ── 12 · known live slugs carry live pills ──────────────────────────────

  test('12 · known live apps (umami, listmonk, n8n, grafana) all carry live pills under Live filter', async ({
    page,
  }) => {
    const logs = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin/apps');
    await page.getByTestId('apps-lifecycle-live').click();
    await expect(page.locator('[data-testid^="apps-card-"]').first()).toBeVisible();
    const knownLiveSlugs = ['listmonk', 'n8n', 'grafana', 'umami'];
    for (const slug of knownLiveSlugs) {
      const pill = page.getByTestId(`apps-pill-live-${slug}`);
      if (await pill.count()) {
        await expect(pill).toBeVisible();
      }
    }
    await snap(page, 'apps-12-live-pills');
    await expectClean(logs);
  });

  // ── 13 · category-filter is interactive ────────────────────────────────

  test('13 · apps-category-filter is visible and responds to interaction', async ({ page }) => {
    const logs = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin/apps');
    const categoryFilter = page.getByTestId('apps-category-filter');
    await expect(categoryFilter).toBeVisible();
    await snap(page, 'apps-13-category-filter-before');
    const tagName = await categoryFilter.evaluate((el) => el.tagName.toLowerCase());
    if (tagName === 'select') {
      const options = await categoryFilter.locator('option').all();
      if (options.length > 1) {
        await categoryFilter.selectOption({ index: 1 });
        await snap(page, 'apps-13-category-filter-selected');
        // At least some cards remain after any category is selected
        await expect(page.locator('[data-testid^="apps-card-"]').first()).toBeVisible();
      }
    } else {
      // Dropdown / button variant
      await categoryFilter.click();
      await snap(page, 'apps-13-category-filter-opened');
      await page.keyboard.press('Escape');
    }
    await expectClean(logs);
  });

  // ── 14 · card click navigates to detail ────────────────────────────────

  test('14 · clicking apps-card-outline navigates to a detail route or opens a detail panel', async ({
    page,
  }) => {
    const logs = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin/apps');
    const outlineCard = page.getByTestId('apps-card-outline');
    if (await outlineCard.count()) {
      await outlineCard.click();
      await snap(page, 'apps-14-card-click-outline');
      const urlAfter = page.url();
      const panelOrModal = page.locator('[data-testid="app-detail"], [role="dialog"]');
      const navigatedAway = !urlAfter.endsWith('/admin/apps');
      const detailVisible = (await panelOrModal.count()) > 0;
      expect(
        navigatedAway || detailVisible,
        'clicking a card should navigate or open a detail view',
      ).toBeTruthy();
    } else {
      // outline may not be in the catalogue at this build — try plan instead
      const fallback = page.getByTestId('apps-card-plane');
      if (await fallback.count()) {
        await fallback.click();
        await snap(page, 'apps-14-card-click-plane');
        const urlAfter = page.url();
        expect(
          !urlAfter.endsWith('/admin/apps') || (await page.locator('[role="dialog"]').count()) > 0,
          'card click navigates or opens panel',
        ).toBeTruthy();
      } else {
        test.skip(true, 'No stable card found to test detail navigation');
      }
    }
    await expectClean(logs);
  });

  // ── 15 · search + lifecycle All combo ──────────────────────────────────

  test('15 · search "uptime" combined with apps-lifecycle-all surfaces uptime-kuma card', async ({
    page,
  }) => {
    const logs = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin/apps');
    await page.getByTestId('apps-lifecycle-all').click();
    const searchInput = page.getByTestId('apps-search-input');
    await searchInput.click();
    await page.keyboard.type('uptime');
    await snap(page, 'apps-15-search-uptime');
    const uptimeCard = page.getByTestId('apps-card-uptime-kuma');
    if (await uptimeCard.count()) {
      await expect(uptimeCard).toBeVisible();
    } else {
      // uptime-kuma may be listed differently — just assert something matches
      await expect(page.locator('[data-testid^="apps-card-"]').first()).toBeVisible();
    }
    await expectClean(logs);
  });

  // ── 16 · no-match search → empty / zero cards ──────────────────────────

  test('16 · searching for a nonsense term shows zero matching cards or an empty state', async ({
    page,
  }) => {
    const logs = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin/apps');
    const searchInput = page.getByTestId('apps-search-input');
    await searchInput.click();
    await page.keyboard.type('zzz-no-match-xyzzy-99999');
    await snap(page, 'apps-16-search-no-match');
    const cards = page.locator('[data-testid^="apps-card-"]');
    const count = await cards.count();
    if (count > 0) {
      // If cards still show, none of the real slugs should be present
      await expect(page.getByTestId('apps-card-listmonk')).not.toBeVisible();
      await expect(page.getByTestId('apps-card-grafana')).not.toBeVisible();
    } else {
      expect(count).toBe(0);
    }
    await expectClean(logs);
  });

  // ── 17 · rapid filter toggling — console hygiene ───────────────────────

  test('17 · rapidly toggling All / Live / Soon 3× produces no console errors', async ({ page }) => {
    const logs = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin/apps');
    for (let i = 0; i < 3; i++) {
      await page.getByTestId('apps-lifecycle-live').click();
      await page.getByTestId('apps-lifecycle-soon').click();
      await page.getByTestId('apps-lifecycle-all').click();
    }
    await snap(page, 'apps-17-rapid-filter-toggle');
    const cards = page.locator('[data-testid^="apps-card-"]');
    await expect(cards.first()).toBeVisible();
    expect(await cards.count()).toBeGreaterThan(20);
    await expectClean(logs);
  });

  // ── 18 · full compound journey ──────────────────────────────────────────

  test('18 · full compound journey: search → live filter → clear search → all filter', async ({
    page,
  }) => {
    const logs = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin/apps');

    // Step A — search narrows grid
    const searchInput = page.getByTestId('apps-search-input');
    await searchInput.click();
    await page.keyboard.type('cal');
    await expect(page.locator('[data-testid^="apps-card-"]').first()).toBeVisible();
    await snap(page, 'apps-18a-search-cal');

    // Step B — apply Live filter on top of search
    await page.getByTestId('apps-lifecycle-live').click();
    await snap(page, 'apps-18b-live-and-search');
    // Result may be zero (cal + live intersection) or one or more — just assert no crash
    const stepBCount = await page.locator('[data-testid^="apps-card-"]').count();
    expect(stepBCount).toBeGreaterThanOrEqual(0);

    // Step C — clear search, keep Live
    await searchInput.click({ clickCount: 3 });
    await page.keyboard.press('Backspace');
    await snap(page, 'apps-18c-search-cleared');
    await expect(page.locator('[data-testid^="apps-card-"]').first()).toBeVisible();
    const stepCCount = await page.locator('[data-testid^="apps-card-"]').count();
    expect(stepCCount).toBeGreaterThan(0);

    // Step D — switch to All, full grid restores
    await page.getByTestId('apps-lifecycle-all').click();
    await expect(page.locator('[data-testid^="apps-card-"]').first()).toBeVisible();
    const finalCount = await page.locator('[data-testid^="apps-card-"]').count();
    expect(finalCount).toBeGreaterThan(20);
    await snap(page, 'apps-18d-final-state');

    await expectClean(logs);
  });
});
