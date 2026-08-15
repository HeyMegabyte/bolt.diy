/**
 * @module e2e/admin-navigation-responsive
 *
 * The three intentional navigation modes, verified against the live admin shell:
 *   390px  → mobile overlay drawer (hamburger, backdrop, Escape, focus)
 *   834px  → 72px compact icon rail (no hamburger, labels hidden)
 *   1440px → full 272px labelled sidebar (no hamburger, labels shown)
 * Plus a keyboard-only open/close cycle with focus restoration.
 *
 * Seeds `ps_session` from `E2E_API_KEY` (same as admin-a11y). Run:
 *   E2E_API_KEY=psk_test_… npx playwright test --config=playwright.prod.config.ts admin-navigation-responsive
 */
import { test, expect, type Page } from '@playwright/test';

const KEY = process.env.E2E_API_KEY ?? '';

async function seed(page: Page): Promise<void> {
  await page.addInitScript((k: string) => {
    try {
      localStorage.setItem(
        'ps_session',
        JSON.stringify({ token: k, identifier: 'test@megabyte.space', createdAt: Date.now() }),
      );
      localStorage.setItem('ps_feedback_dismissed', 'true');
    } catch {
      /* private mode */
    }
  }, KEY);
}

async function gotoAdmin(page: Page): Promise<void> {
  await seed(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/admin/analytics', { waitUntil: 'load' });
  await expect(page.locator('#admin-primary-nav')).toBeVisible({ timeout: 30000 });
}

test.describe('admin navigation — responsive modes', () => {
  test.skip(!KEY, 'E2E_API_KEY not set');
  test.describe.configure({ retries: 2 });

  test('mobile (390px): overlay drawer with hamburger, backdrop, Escape', async ({ page }) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoAdmin(page);

    const hamburger = page.locator('.admin-hamburger');
    const sidebar = page.locator('#admin-primary-nav');

    // Only the hamburger is the nav affordance; the sidebar is an offscreen,
    // inert drawer (not a persistent rail).
    await expect(hamburger).toBeVisible();
    await expect(sidebar).toHaveClass(/admin-sidebar--drawer/);
    await expect(sidebar).not.toHaveClass(/admin-sidebar--open/);
    await expect(sidebar).toHaveAttribute('inert', '');
    const closedBox = await sidebar.boundingBox();
    expect(closedBox && closedBox.x + closedBox.width).toBeLessThanOrEqual(1); // fully offscreen left

    // Open → slides in from the left, backdrop appears, aria-expanded flips.
    await hamburger.click();
    await expect(sidebar).toHaveClass(/admin-sidebar--open/);
    await expect(hamburger).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('.admin-drawer-backdrop')).toBeVisible();
    const openBox = await sidebar.boundingBox();
    expect(openBox && openBox.x).toBeGreaterThanOrEqual(-1);
    expect(openBox && openBox.width).toBeLessThanOrEqual(340); // ~min(320, 100vw-48)

    // Escape closes it.
    await page.keyboard.press('Escape');
    await expect(sidebar).not.toHaveClass(/admin-sidebar--open/);

    // Backdrop click closes it. Click the EXPOSED scrim (right of the ~320px
    // drawer) — clicking over the drawer would hit the drawer, not the backdrop.
    await hamburger.click();
    await expect(sidebar).toHaveClass(/admin-sidebar--open/);
    await page.locator('.admin-drawer-backdrop').click({ position: { x: 360, y: 420 } });
    await expect(sidebar).not.toHaveClass(/admin-sidebar--open/);

    // Selecting a destination navigates AND closes the drawer.
    await hamburger.click();
    await page.locator('[data-testid="nav-forms"]').click();
    await expect(page).toHaveURL(/\/admin\/forms/);
    await expect(sidebar).not.toHaveClass(/admin-sidebar--open/);
  });

  test('compact (834px): 72px icon rail, no hamburger, labels hidden', async ({ page }) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width: 834, height: 1112 });
    await gotoAdmin(page);

    await expect(page.locator('.admin-hamburger')).toHaveCount(0);
    const sidebar = page.locator('#admin-primary-nav');
    await expect(sidebar).toBeVisible();
    await expect(sidebar).toHaveClass(/admin-sidebar--rail/);

    const box = await sidebar.boundingBox();
    expect(box && box.width).toBeGreaterThan(58);
    expect(box && box.width).toBeLessThan(96);

    // Labels + group headings are hidden; icons remain.
    await expect(page.locator('.nav-group-label').first()).toBeHidden();
    await expect(page.locator('[data-testid="nav-forms"] app-nav-icon').first()).toBeVisible();
    await expect(page.locator('[data-testid="nav-forms"] span').first()).toBeHidden();
  });

  test('desktop (1440px): full labelled sidebar, no hamburger', async ({ page }) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoAdmin(page);

    await expect(page.locator('.admin-hamburger')).toHaveCount(0);
    const sidebar = page.locator('#admin-primary-nav');
    await expect(sidebar).toBeVisible();
    await expect(sidebar).not.toHaveClass(/admin-sidebar--rail/);
    await expect(sidebar).not.toHaveClass(/admin-sidebar--drawer/);

    const box = await sidebar.boundingBox();
    expect(box && box.width).toBeGreaterThan(255);
    expect(box && box.width).toBeLessThan(300);

    // Group headings + labels are visible.
    await expect(page.locator('.nav-group-label').first()).toBeVisible();
    await expect(page.locator('[data-testid="nav-forms"] span').first()).toHaveText('Forms');
  });

  test('breakpoint boundary: full labelled sidebar only at >= 1297px', async ({ page }) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width: 1400, height: 900 });
    await gotoAdmin(page);
    const sidebar = page.locator('#admin-primary-nav');

    // 1296px — one below the threshold — stays the compact icon rail.
    await page.setViewportSize({ width: 1296, height: 900 });
    await expect(sidebar).toHaveClass(/admin-sidebar--rail/);
    await expect(page.locator('.nav-group-label').first()).toBeHidden();

    // 1297px — the full labelled sidebar takes over.
    await page.setViewportSize({ width: 1297, height: 900 });
    await expect(sidebar).not.toHaveClass(/admin-sidebar--rail/);
    await expect(page.locator('.nav-group-label').first()).toBeVisible();
    const box = await sidebar.boundingBox();
    expect(box && box.width).toBeGreaterThan(255);
  });

  test('keyboard-only: open, close, and focus restoration (390px)', async ({ page }) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoAdmin(page);

    const hamburger = page.locator('.admin-hamburger');
    await hamburger.focus();
    await expect(hamburger).toBeFocused();

    // Enter opens the drawer and focus moves inside it (FocusTrapDirective).
    await page.keyboard.press('Enter');
    await expect(page.locator('#admin-primary-nav')).toHaveClass(/admin-sidebar--open/);
    const focusInDrawer = await page.evaluate(
      () => !!document.getElementById('admin-primary-nav')?.contains(document.activeElement),
    );
    expect(focusInDrawer).toBe(true);

    // Escape closes it AND restores focus to the hamburger.
    await page.keyboard.press('Escape');
    await expect(page.locator('#admin-primary-nav')).not.toHaveClass(/admin-sidebar--open/);
    await expect(hamburger).toBeFocused();
  });

  test('compact rail: hover expands to the full sidebar as an OVERLAY (content does not shift)', async ({
    page,
  }) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width: 834, height: 1112 });
    await gotoAdmin(page);

    const sidebar = page.locator('#admin-primary-nav');
    const content = page.locator('.admin-topbar');
    await expect(sidebar).toHaveClass(/admin-sidebar--rail/);

    // At rest: ~72px icon rail, labels hidden.
    expect((await sidebar.boundingBox())!.width).toBeLessThan(96);
    const contentLeftAtRest = (await content.boundingBox())!.x;
    await expect(page.locator('[data-testid="nav-forms"] span').first()).toBeHidden();

    // Hover → expands to the full ~272px labelled sidebar.
    await sidebar.hover();
    await expect(page.locator('[data-testid="nav-forms"] span').first()).toBeVisible();
    await expect.poll(async () => (await sidebar.boundingBox())!.width).toBeGreaterThan(255);
    const expanded = (await sidebar.boundingBox())!;
    expect(expanded.width).toBeLessThan(300);

    // CRITICAL — it OVERLAYS, it does not push: the content's left edge is
    // unchanged (no reflow) and the expanded panel paints OVER the content.
    const contentLeftHovered = (await content.boundingBox())!.x;
    expect(Math.abs(contentLeftHovered - contentLeftAtRest)).toBeLessThanOrEqual(1);
    expect(expanded.x + expanded.width).toBeGreaterThan(contentLeftHovered + 100);

    // Mouse-leave → collapses back to the 72px rail.
    await page.mouse.move(640, 620);
    await expect.poll(async () => (await sidebar.boundingBox())!.width).toBeLessThan(96);
    await expect(page.locator('[data-testid="nav-forms"] span').first()).toBeHidden();
  });

  test('compact rail: keyboard focus expands it too (focus-within), no content shift', async ({
    page,
  }) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width: 834, height: 1112 });
    await gotoAdmin(page);

    const sidebar = page.locator('#admin-primary-nav');
    const content = page.locator('.admin-topbar');
    await expect(sidebar).toHaveClass(/admin-sidebar--rail/);
    const contentLeftAtRest = (await content.boundingBox())!.x;

    // Move keyboard focus into the rail → it expands via :focus-within.
    await page.locator('[data-testid="nav-forms"]').focus();
    await expect.poll(async () => (await sidebar.boundingBox())!.width).toBeGreaterThan(255);
    await expect(page.locator('[data-testid="nav-forms"] span').first()).toBeVisible();

    // Still an overlay — content did not move.
    expect(Math.abs((await content.boundingBox())!.x - contentLeftAtRest)).toBeLessThanOrEqual(1);
  });
});
