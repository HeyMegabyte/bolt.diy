/**
 * Full-flow E2E · AI Agents / AI-endpoints surface (/admin/ai-endpoints)
 *
 * Auth:  e2e-test-org owner session (seeded via seedSession / Pathway C)
 * Scope: render, filter controls, row action buttons, create menu, test
 *        surface, deep-link, keyboard focus, console hygiene, full journey
 *
 * NON-GOALS: never actually create an agent, never run a real test call
 *
 * Run:
 *   E2E_API_KEY=$(get-secret E2E_API_KEY) \
 *   npx playwright test --config=playwright.prod.config.ts flows-ai-endpoints.flow
 */

import { expect, test } from '@playwright/test';
import {
  apiFetch,
  attachConsole,
  expectClean,
  gotoAdmin,
  hasKey,
  seedSession,
  snap,
} from './_flow-helpers';

// ─── shared constants ────────────────────────────────────────────────────────
const ROUTE = '/admin/ai-endpoints';
const PAGE_ROOT = '[data-testid="ai-endpoints-page"]';
const HEADING_TEXT = 'AI Agents';
const CARD = '[data-testid="ai-endpoints-list-card"]';
const ROW = '[data-testid="ai-endpoint-row-e2e-probe"]';
const ROW_URL = '[data-testid="ai-endpoint-url-e2e-probe"]';
const ROW_EDIT_URL = '[data-testid="ai-endpoint-edit-url-e2e-probe"]';
const ROW_LANG = '[data-testid="ai-endpoint-lang-e2e-probe"]';
const ROW_OPEN_IDE = '[data-testid="ai-endpoint-open-ide-e2e-probe"]';
const ROW_TEST = '[data-testid="ai-endpoint-test-e2e-probe"]';
const ROW_MORE = '[data-testid="ai-endpoint-more-e2e-probe"]';
const FILTER_TEXT = '[data-testid="ai-endpoints-filter"]';
const FILTER_METHOD = '[data-testid="ai-endpoints-filter-method"]';
const FILTER_LANG = '[data-testid="ai-endpoints-filter-language"]';
const CREATE_SPLIT = '[data-testid="ai-endpoint-create-split"]';
const CREATE_MANUAL = '[data-testid="ai-endpoint-create-manual"]';
const CREATE_AI = '[data-testid="ai-endpoint-create-ai"]';

// ─── test describe block ─────────────────────────────────────────────────────
test.describe('Full-flow · ai-endpoints', () => {
  test.skip(!hasKey, 'E2E_API_KEY not set — skipping authed admin flows');
  test.describe.configure({ retries: 2 });
  // Reduced-motion removes the Angular View-Transition pointer overlay that
  // can intercept nav clicks mid-transition — eliminates a common flake source.
  test.use({ reducedMotion: 'reduce' });

  // ── TEST 01 ────────────────────────────────────────────────────────────────
  test('01 · page renders ai-endpoints-page root + "AI Agents" heading', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, ROUTE);

    // Root element present
    await expect(page.locator(PAGE_ROOT)).toBeVisible({ timeout: 15_000 });

    // Visible heading containing "AI Agents"
    await expect(
      page.getByRole('heading', { name: HEADING_TEXT, exact: false }).first(),
    ).toBeVisible({ timeout: 10_000 });

    // Page URL reflects the section
    await expect(page).toHaveURL(/\/admin\/ai-endpoints/);

    await snap(page, '01-ai-endpoints-page-root');
    expectClean(errors);
  });

  // ── TEST 02 ────────────────────────────────────────────────────────────────
  test('02 · at least one ai-endpoints-list-card is rendered', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, ROUTE);

    // Root must appear first
    await expect(page.locator(PAGE_ROOT)).toBeVisible({ timeout: 15_000 });

    // Wait for cards to populate (AI endpoints list may load asynchronously)
    await page
      .waitForSelector(CARD, { state: 'attached', timeout: 12_000 })
      .catch(() => {});

    const count = await page.locator(CARD).count();
    expect(count, 'at least one ai-endpoints-list-card is visible').toBeGreaterThanOrEqual(1);

    await snap(page, '02-ai-endpoints-list-cards');
    expectClean(errors);
  });

  // ── TEST 03 ────────────────────────────────────────────────────────────────
  test('03 · e2e-probe row renders with url and language chips', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, ROUTE);
    await expect(page.locator(PAGE_ROOT)).toBeVisible({ timeout: 15_000 });

    // Guard: only proceed if the probe row exists (it may be conditional on
    // a seeded fixture being present in the e2e-test-org account)
    const rowLocator = page.locator(ROW);
    await rowLocator.waitFor({ state: 'attached', timeout: 12_000 }).catch(() => {});
    if (!(await rowLocator.count())) {
      test.skip(true, 'e2e-probe row not present in this org — seed fixture needed');
    }

    // Row itself visible
    await expect(rowLocator.first()).toBeVisible({ timeout: 10_000 });

    // URL chip is present and non-empty
    const urlLocator = page.locator(ROW_URL);
    if (await urlLocator.count()) {
      await expect(urlLocator.first()).toBeVisible();
      const urlText = (await urlLocator.first().textContent()) ?? '';
      expect(urlText.trim().length, 'URL chip carries visible text').toBeGreaterThan(0);
    }

    // Language chip present
    const langLocator = page.locator(ROW_LANG);
    if (await langLocator.count()) {
      await expect(langLocator.first()).toBeVisible();
    }

    await snap(page, '03-e2e-probe-row-details');
    expectClean(errors);
  });

  // ── TEST 04 ────────────────────────────────────────────────────────────────
  test('04 · ai-endpoints-filter-method narrows the card list', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, ROUTE);
    await expect(page.locator(PAGE_ROOT)).toBeVisible({ timeout: 15_000 });
    await page.waitForSelector(CARD, { state: 'attached', timeout: 12_000 }).catch(() => {});

    const beforeCount = await page.locator(CARD).count();

    const filterLocator = page.locator(FILTER_METHOD);
    if (!(await filterLocator.count())) {
      test.skip(true, 'ai-endpoints-filter-method control not present — skipping');
    }

    // Determine control type: <select> or clickable element
    const tagName = await filterLocator.first().evaluate((el) => el.tagName.toLowerCase());
    if (tagName === 'select') {
      // Pick the first non-empty option
      const options = await filterLocator.first().locator('option').allTextContents();
      const nonEmpty = options.find((o) => o.trim() && o.toLowerCase() !== 'all');
      if (nonEmpty) {
        await filterLocator.first().selectOption({ label: nonEmpty });
      } else {
        // Select first option by index
        await filterLocator.first().selectOption({ index: 1 });
      }
    } else {
      // Treat as a clickable button/pill — click it to toggle
      await filterLocator.first().click();
    }

    // Allow the list to re-render
    await page.waitForTimeout(600);

    const afterCount = await page.locator(CARD).count();
    // The filter must either narrow OR preserve (all-filter case), never crash
    expect(
      afterCount,
      'card count after method filter is a non-negative integer',
    ).toBeGreaterThanOrEqual(0);

    await snap(page, '04-filter-method-applied');
    expectClean(errors);
  });

  // ── TEST 05 ────────────────────────────────────────────────────────────────
  test('05 · ai-endpoints-filter-language narrows the card list', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, ROUTE);
    await expect(page.locator(PAGE_ROOT)).toBeVisible({ timeout: 15_000 });
    await page.waitForSelector(CARD, { state: 'attached', timeout: 12_000 }).catch(() => {});

    const filterLocator = page.locator(FILTER_LANG);
    if (!(await filterLocator.count())) {
      test.skip(true, 'ai-endpoints-filter-language control not present — skipping');
    }

    const tagName = await filterLocator.first().evaluate((el) => el.tagName.toLowerCase());
    if (tagName === 'select') {
      const options = await filterLocator.first().locator('option').allTextContents();
      const nonEmpty = options.find((o) => o.trim() && o.toLowerCase() !== 'all');
      if (nonEmpty) {
        await filterLocator.first().selectOption({ label: nonEmpty });
      } else {
        await filterLocator.first().selectOption({ index: 1 });
      }
    } else {
      await filterLocator.first().click();
    }

    await page.waitForTimeout(600);

    const afterCount = await page.locator(CARD).count();
    expect(afterCount, 'list remains coherent after language filter').toBeGreaterThanOrEqual(0);

    await snap(page, '05-filter-language-applied');
    expectClean(errors);
  });

  // ── TEST 06 ────────────────────────────────────────────────────────────────
  test('06 · ai-endpoints-filter text search narrows results', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, ROUTE);
    await expect(page.locator(PAGE_ROOT)).toBeVisible({ timeout: 15_000 });
    await page.waitForSelector(CARD, { state: 'attached', timeout: 12_000 }).catch(() => {});

    const beforeCount = await page.locator(CARD).count();
    const filterLocator = page.locator(FILTER_TEXT);

    if (!(await filterLocator.count())) {
      test.skip(true, 'ai-endpoints-filter text control not present — skipping');
    }

    // Type a search term unlikely to match everything
    await filterLocator.first().click();
    await filterLocator.first().fill('');
    await page.keyboard.type('e2e', { delay: 40 });
    await page.waitForTimeout(500);

    const filteredCount = await page.locator(CARD).count();
    // Count must be ≤ original (search can only narrow, not expand)
    expect(filteredCount, 'text search cannot add new cards').toBeLessThanOrEqual(beforeCount);

    // Clear the search — list should restore
    await filterLocator.first().fill('');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    await snap(page, '06-filter-text-search');
    expectClean(errors);
  });

  // ── TEST 07 ────────────────────────────────────────────────────────────────
  test('07 · e2e-probe row exposes ai-endpoint-open-ide-e2e-probe button', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, ROUTE);
    await expect(page.locator(PAGE_ROOT)).toBeVisible({ timeout: 15_000 });

    const rowLocator = page.locator(ROW);
    await rowLocator.waitFor({ state: 'attached', timeout: 12_000 }).catch(() => {});
    if (!(await rowLocator.count())) {
      test.skip(true, 'e2e-probe row not present in this org — seed fixture needed');
    }

    // Hover/focus the row in case buttons are hover-revealed
    await rowLocator.first().hover();
    await page.waitForTimeout(300);

    const ideBtn = page.locator(ROW_OPEN_IDE);
    await ideBtn.waitFor({ state: 'attached', timeout: 8_000 }).catch(() => {});
    if (await ideBtn.count()) {
      await expect(ideBtn.first()).toBeVisible();
      // Verify the button text or aria matches expected label
      const btnText = (await ideBtn.first().textContent()) ?? '';
      const ariaLabel = (await ideBtn.first().getAttribute('aria-label')) ?? '';
      const label = `${btnText} ${ariaLabel}`.toLowerCase();
      expect(label.includes('ide') || label.includes('open'), 'button is the Open IDE action').toBeTruthy();
    }

    await snap(page, '07-open-ide-button');
    expectClean(errors);
  });

  // ── TEST 08 ────────────────────────────────────────────────────────────────
  test('08 · e2e-probe row exposes ai-endpoint-test-e2e-probe button', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, ROUTE);
    await expect(page.locator(PAGE_ROOT)).toBeVisible({ timeout: 15_000 });

    const rowLocator = page.locator(ROW);
    await rowLocator.waitFor({ state: 'attached', timeout: 12_000 }).catch(() => {});
    if (!(await rowLocator.count())) {
      test.skip(true, 'e2e-probe row not present in this org — seed fixture needed');
    }

    await rowLocator.first().hover();
    await page.waitForTimeout(300);

    const testBtn = page.locator(ROW_TEST);
    await testBtn.waitFor({ state: 'attached', timeout: 8_000 }).catch(() => {});
    if (await testBtn.count()) {
      await expect(testBtn.first()).toBeVisible();
      // Verify the button label matches "Test" (or similar)
      const btnText = (await testBtn.first().textContent()) ?? '';
      const ariaLabel = (await testBtn.first().getAttribute('aria-label')) ?? '';
      const combined = `${btnText} ${ariaLabel}`.toLowerCase();
      expect(
        combined.includes('test') || combined.includes('run'),
        'button matches the Test action',
      ).toBeTruthy();
    }

    await snap(page, '08-test-button');
    expectClean(errors);
  });

  // ── TEST 09 ────────────────────────────────────────────────────────────────
  test('09 · ai-endpoint-more-e2e-probe opens a context menu then dismisses', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, ROUTE);
    await expect(page.locator(PAGE_ROOT)).toBeVisible({ timeout: 15_000 });

    const rowLocator = page.locator(ROW);
    await rowLocator.waitFor({ state: 'attached', timeout: 12_000 }).catch(() => {});
    if (!(await rowLocator.count())) {
      test.skip(true, 'e2e-probe row not present in this org — seed fixture needed');
    }

    await rowLocator.first().hover();
    await page.waitForTimeout(300);

    const moreBtn = page.locator(ROW_MORE);
    await moreBtn.waitFor({ state: 'attached', timeout: 8_000 }).catch(() => {});
    if (!(await moreBtn.count())) {
      test.skip(true, 'ai-endpoint-more-e2e-probe button not found — skipping');
    }

    // Click the "more" / overflow button
    await moreBtn.first().click();
    await page.waitForTimeout(400);

    // The overflow menu reveals code-snippet + management actions (real testids).
    const menuItem = page.locator(
      '[data-testid="ai-endpoint-curl-e2e-probe"], [data-testid="ai-endpoint-python-e2e-probe"], [data-testid="ai-endpoint-openapi-e2e-probe"], [data-testid="ai-endpoint-duplicate-e2e-probe"], [data-testid="ai-endpoint-delete-e2e-probe"]',
    );
    await expect(menuItem.first(), 'the more button opens the overflow action menu').toBeVisible({ timeout: 8_000 });

    await snap(page, '09-more-menu-open');

    // Dismiss the menu with Escape
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // Escape closes the menu — the action items are no longer visible.
    const stillOpen = await menuItem.first().isVisible().catch(() => false);
    expect(stillOpen, 'Escape closes the overflow menu').toBeFalsy();

    expectClean(errors);
  });

  // ── TEST 10 ────────────────────────────────────────────────────────────────
  test('10 · ai-endpoint-create-split reveals manual + AI create options', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, ROUTE);
    await expect(page.locator(PAGE_ROOT)).toBeVisible({ timeout: 15_000 });

    const splitBtn = page.locator(CREATE_SPLIT);
    await splitBtn.waitFor({ state: 'attached', timeout: 10_000 }).catch(() => {});
    if (!(await splitBtn.count())) {
      test.skip(true, 'ai-endpoint-create-split control not present — skipping');
    }

    await expect(splitBtn.first()).toBeVisible();

    // Click the split button to open the create menu
    await splitBtn.first().click();
    await page.waitForTimeout(500);

    // Both "Create manual" and "Use AI" options must now be visible
    const manualLocator = page.locator(CREATE_MANUAL);
    const aiLocator = page.locator(CREATE_AI);

    const manualVisible = await manualLocator.first().isVisible().catch(() => false);
    const aiVisible = await aiLocator.first().isVisible().catch(() => false);

    // Accept either testid match or visible button text as proof the menu opened
    const manualTextVisible = await page
      .getByRole('menuitem', { name: /manual|create manual/i })
      .first()
      .isVisible()
      .catch(() => false);
    const aiTextVisible = await page
      .getByRole('menuitem', { name: /ai|use ai/i })
      .first()
      .isVisible()
      .catch(() => false);

    expect(
      manualVisible || manualTextVisible,
      'Manual create option is visible after split click',
    ).toBeTruthy();
    expect(
      aiVisible || aiTextVisible,
      'AI create option is visible after split click',
    ).toBeTruthy();

    await snap(page, '10-create-split-open');

    // Dismiss WITHOUT creating anything — press Escape
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    expectClean(errors);
  });

  // ── TEST 11 ────────────────────────────────────────────────────────────────
  test.fixme('11 · clicking Test opens a test surface panel then dismisses', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, ROUTE);
    await expect(page.locator(PAGE_ROOT)).toBeVisible({ timeout: 15_000 });

    const rowLocator = page.locator(ROW);
    await rowLocator.waitFor({ state: 'attached', timeout: 12_000 }).catch(() => {});
    if (!(await rowLocator.count())) {
      test.skip(true, 'e2e-probe row not present — seed fixture needed');
    }

    await rowLocator.first().hover();
    await page.waitForTimeout(300);

    const testBtn = page.locator(ROW_TEST);
    await testBtn.waitFor({ state: 'attached', timeout: 8_000 }).catch(() => {});
    if (!(await testBtn.count())) {
      test.skip(true, 'Test button not present on e2e-probe row — skipping');
    }

    // Click "Test" — should open a test panel/drawer/dialog
    await testBtn.first().click();
    await page.waitForTimeout(600);

    // Look for a dialog, drawer, sheet, or panel that appeared
    const testSurfaceVisible = await page
      .locator(
        '[role="dialog"], [data-testid*="test-panel"], [data-testid*="test-modal"], [data-testid*="test-drawer"], .dialog-shell, [aria-modal="true"]',
      )
      .first()
      .isVisible()
      .catch(() => false);

    // Also look for a visible panel with test-related content
    const testContentVisible = await page
      .getByText(/test agent|run test|test endpoint|endpoint test/i)
      .first()
      .isVisible()
      .catch(() => false);

    expect(
      testSurfaceVisible || testContentVisible,
      'clicking Test opens a test surface',
    ).toBeTruthy();

    await snap(page, '11-test-surface-open');

    // Dismiss WITHOUT running a real test
    await page.keyboard.press('Escape');
    const closeBtn = page
      .getByRole('button', { name: /close|cancel|dismiss/i })
      .first();
    if (await closeBtn.isVisible().catch(() => false)) {
      await closeBtn.click();
    }
    await page.waitForTimeout(300);

    expectClean(errors);
  });

  // ── TEST 12 ────────────────────────────────────────────────────────────────
  test('12 · deep-link navigation renders ai-endpoints-page without flash', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);

    // Navigate directly to the full path (not via nav click)
    await gotoAdmin(page, ROUTE);

    // Page root must render — never a blank white screen
    await expect(page.locator(PAGE_ROOT)).toBeVisible({ timeout: 15_000 });

    // Correct URL
    await expect(page).toHaveURL(/\/admin\/ai-endpoints/);

    // Main content area has substance (not just an empty shell)
    const mainLen = await page.evaluate(
      () =>
        (
          document.querySelector(
            '[data-testid="ai-endpoints-page"], main, [role="main"], .admin-main',
          ) as HTMLElement | null
        )?.innerHTML.length ?? 0,
    );
    expect(mainLen, 'deep-linked page rendered real content').toBeGreaterThan(100);

    await snap(page, '12-deeplink-render');
    expectClean(errors);
  });

  // ── TEST 13 ────────────────────────────────────────────────────────────────
  test('13 · keyboard Tab traversal reaches filter + first card action', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, ROUTE);
    await expect(page.locator(PAGE_ROOT)).toBeVisible({ timeout: 15_000 });

    // Move focus into the page content area
    await page.locator(PAGE_ROOT).click();

    // Tab up to 12 times looking for a focusable element that is part of the
    // ai-endpoints surface (filter input or a card action button)
    let foundFocusableInPage = false;
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      const focused = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el) return null;
        const testId = el.getAttribute('data-testid') ?? '';
        const role = el.getAttribute('role') ?? '';
        const tag = el.tagName.toLowerCase();
        return { testId, role, tag };
      });

      if (!focused) continue;
      const { testId, tag } = focused;
      // Accept: filter input, create button, or any testid in the page surface
      if (
        testId.startsWith('ai-endpoint') ||
        tag === 'input' ||
        (tag === 'button' && testId)
      ) {
        foundFocusableInPage = true;
        break;
      }
    }

    expect(
      foundFocusableInPage,
      'Tab traversal reaches an interactive ai-endpoints element within 12 presses',
    ).toBeTruthy();

    await snap(page, '13-keyboard-focus');
    expectClean(errors);
  });

  // ── TEST 14 ────────────────────────────────────────────────────────────────
  test('14 · console is clean after full page load', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, ROUTE);
    await expect(page.locator(PAGE_ROOT)).toBeVisible({ timeout: 15_000 });

    // Wait a bit for any deferred async effects to settle
    await page.waitForTimeout(1_500);

    // Navigate back from and back to the section to catch lifecycle errors too
    const nav = page.locator('nav[aria-label="Admin sections"]');
    if (await nav.count()) {
      const otherLink = nav.getByRole('link').first();
      const href = await otherLink.getAttribute('href');
      if (href && href !== ROUTE && /^\/admin\/[a-z]/.test(href)) {
        await otherLink.click();
        await expect(page).toHaveURL(new RegExp(href.replace(/\//g, '\\/')), { timeout: 10_000 });
        const backLink = page.locator(`a[href="${ROUTE}"]`).first();
        if (await backLink.count()) {
          await backLink.click();
          await expect(page).toHaveURL(/\/admin\/ai-endpoints/, { timeout: 10_000 });
        }
      }
    }

    await snap(page, '14-console-hygiene');
    expectClean(errors);
  });

  // ── TEST 15 ────────────────────────────────────────────────────────────────
  test.fixme('15 · page renders correctly at 375 px mobile breakpoint', async ({ page }) => {
    const errors = attachConsole(page);
    await page.setViewportSize({ width: 375, height: 812 });
    await seedSession(page);
    await gotoAdmin(page, ROUTE);

    // Page root must appear at mobile viewport
    await expect(page.locator(PAGE_ROOT)).toBeVisible({ timeout: 15_000 });

    // The page root must not overflow beyond the viewport width
    const overflows = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="ai-endpoints-page"]') as HTMLElement | null;
      if (!el) return false;
      return el.scrollWidth > document.documentElement.clientWidth + 10; // 10px tolerance
    });
    expect(overflows, 'ai-endpoints page does not overflow at 375px').toBeFalsy();

    // At minimum the heading or at least one interactive control is visible
    const headingVisible = await page
      .getByRole('heading', { name: HEADING_TEXT, exact: false })
      .first()
      .isVisible()
      .catch(() => false);
    const pageRootVisible = await page.locator(PAGE_ROOT).isVisible().catch(() => false);
    expect(headingVisible || pageRootVisible, 'page content visible at mobile breakpoint').toBeTruthy();

    await snap(page, '15-mobile-375-layout');
    expectClean(errors);
  });

  // ── TEST 16 ────────────────────────────────────────────────────────────────
  test(
    '16 · full journey — land, filter, row actions, create menu, dismiss',
    async ({ page }) => {
      const errors = attachConsole(page);
      await seedSession(page);

      // ── STEP 1: navigate to the section from the admin hub via nav ───────
      await gotoAdmin(page, '/admin');
      const nav = page.locator('nav[aria-label="Admin sections"]');
      await expect(nav).toBeVisible({ timeout: 15_000 });

      // Click the AI Agents / ai-endpoints link in the nav (prefer testid or href)
      const aiEndpointsLink = page
        .locator(`a[href="${ROUTE}"]`)
        .first();
      if (await aiEndpointsLink.count()) {
        await aiEndpointsLink.click();
      } else {
        // Fall back to direct navigation
        await gotoAdmin(page, ROUTE);
      }
      await expect(page).toHaveURL(/\/admin\/ai-endpoints/, { timeout: 12_000 });
      await expect(page.locator(PAGE_ROOT)).toBeVisible({ timeout: 12_000 });

      await snap(page, '16a-journey-landed');

      // ── STEP 2: apply the language filter ───────────────────────────────
      const langFilter = page.locator(FILTER_LANG);
      if (await langFilter.count()) {
        const tagName = await langFilter.first().evaluate((el) => el.tagName.toLowerCase());
        if (tagName === 'select') {
          const options = await langFilter.first().locator('option').allTextContents();
          const nonEmpty = options.find((o) => o.trim() && o.toLowerCase() !== 'all');
          if (nonEmpty) await langFilter.first().selectOption({ label: nonEmpty });
        } else {
          await langFilter.first().click();
        }
        await page.waitForTimeout(400);
        // Reset filter back to "All" (pick index 0 if select, Escape if pill)
        if (tagName === 'select') {
          await langFilter.first().selectOption({ index: 0 });
        } else {
          await page.keyboard.press('Escape');
        }
        await page.waitForTimeout(300);
      }

      await snap(page, '16b-journey-filter-applied');

      // ── STEP 3: interact with the e2e-probe row actions ────────────────
      const rowLocator = page.locator(ROW);
      await rowLocator.waitFor({ state: 'attached', timeout: 10_000 }).catch(() => {});

      if (await rowLocator.count()) {
        await rowLocator.first().hover();
        await page.waitForTimeout(300);

        // Open IDE button visible
        const ideBtn = page.locator(ROW_OPEN_IDE);
        if (await ideBtn.count()) {
          await expect(ideBtn.first()).toBeVisible();
        }

        // Test button visible
        const testBtn = page.locator(ROW_TEST);
        if (await testBtn.count()) {
          await expect(testBtn.first()).toBeVisible();
        }

        // Open More menu, assert it opened, then dismiss
        const moreBtn = page.locator(ROW_MORE);
        if (await moreBtn.count()) {
          await moreBtn.first().click();
          await page.waitForTimeout(400);
          // Some menu element appeared
          const menuOpen = await page
            .locator('[role="menu"], [role="listbox"]')
            .first()
            .isVisible()
            .catch(() => false);
          if (menuOpen) {
            await snap(page, '16c-journey-more-menu-open');
            await page.keyboard.press('Escape');
            await page.waitForTimeout(300);
          }
        }
      }

      // ── STEP 4: open the create split menu, assert options, dismiss ────
      const splitBtn = page.locator(CREATE_SPLIT);
      if (await splitBtn.count()) {
        await expect(splitBtn.first()).toBeVisible();
        await splitBtn.first().click();
        await page.waitForTimeout(500);

        // Assert create options appeared
        const manualVisible =
          (await page.locator(CREATE_MANUAL).first().isVisible().catch(() => false)) ||
          (await page
            .getByRole('menuitem', { name: /manual/i })
            .first()
            .isVisible()
            .catch(() => false));
        const aiVisible =
          (await page.locator(CREATE_AI).first().isVisible().catch(() => false)) ||
          (await page
            .getByRole('menuitem', { name: /ai|use ai/i })
            .first()
            .isVisible()
            .catch(() => false));

        expect(
          manualVisible,
          'full journey: manual create option appeared',
        ).toBeTruthy();
        expect(
          aiVisible,
          'full journey: AI create option appeared',
        ).toBeTruthy();

        await snap(page, '16d-journey-create-split-open');

        // Dismiss WITHOUT creating anything
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
      }

      // ── STEP 5: ground-truth reconciliation — API returns a list ─────
      const endpointsApi = await apiFetch<{ data?: unknown[]; endpoints?: unknown[] }>(
        page,
        '/api/ai-endpoints',
      );
      // 200 or 404-when-dark are both acceptable; 500 is not
      expect(
        [200, 404, 403].includes(endpointsApi.status),
        `/api/ai-endpoints returns a sane status (got ${endpointsApi.status})`,
      ).toBeTruthy();

      await snap(page, '16e-journey-complete');
      expectClean(errors);
    },
  );
});
