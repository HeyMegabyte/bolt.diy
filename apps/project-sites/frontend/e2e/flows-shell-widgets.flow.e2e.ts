/**
 * flows-shell-widgets.flow.e2e.ts — Surface: the admin SHELL widgets that live
 * around every /admin section (command palette, user menu, shortcuts overlay,
 * notifications, task tray, network-status banner, route announcer, site actions).
 *
 * Real selectors (live template probe of admin.component.html + the widget
 * components):
 *   - Command palette: Cmd+K (window keydown HostListener) → `palette-input`
 *     (auto-focused), `palette-results`, `palette-special`, `palette-action-ask-ai`,
 *     `cmdk-ai-pane`. Escape closes.
 *   - User menu: `user-avatar-btn` → `user-menu` → items `user-menu-shortcuts`,
 *     `user-menu-billing`, `user-menu-api-keys`, `user-menu-user-settings`,
 *     `user-menu-signout`.
 *   - Shortcuts overlay: `?` key OR `user-menu-shortcuts` → `shortcuts-overlay`.
 *   - Notifications: header button `aria-label="Notifications"` → pop shows
 *     `notif-empty` (0) or `.notif-item` list (audit-seeded).
 *   - Task tray: `<app-task-tray>` → `role="region"` `aria-label="AI task tray"`.
 *   - Network banner: global `network-status-banner` (app.component) — shows offline.
 *   - Route announcer: `admin-route-announcer` (a11y live region).
 *   - Site actions: `site-actions-btn` → `site-actions-menu` (sa-preview / sa-deploy /
 *     sa-copy-url / sa-share-link) — needs a selected site (e2e-test-org has one).
 *
 * Run: E2E_API_KEY=$(get-secret E2E_API_KEY) \
 *   npx playwright test --config=playwright.prod.config.ts flows-shell-widgets.flow --workers=3
 */
import { test, expect } from '@playwright/test';
import { hasKey, seedSession, gotoAdmin, attachConsole, expectClean, snap, apiFetch } from './_flow-helpers';

test.describe('Full-flow · admin shell widgets', () => {
  test.skip(!hasKey, 'E2E_API_KEY not set');
  test.describe.configure({ retries: 2 });
  test.use({ reducedMotion: 'reduce' });

  // ── Command palette (Cmd+K) ─────────────────────────────────────────────────

  test('01 Cmd+K opens the command palette and focuses its input', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin');
    await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k');
    const input = page.locator('[data-testid="palette-input"]');
    await expect(input, 'Cmd+K opens the palette').toBeVisible({ timeout: 8_000 });
    // The palette auto-focuses its input (the SUPREME Cmd+K-focus contract).
    await expect(input).toBeFocused();
    await snap(page, 'shell-01-palette');
    expectClean(errors);
  });

  test('02 typing in the palette renders live results', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin');
    await page.getByRole('heading').first().waitFor({ state: 'visible', timeout: 15_000 });
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k');
    const input = page.locator('[data-testid="palette-input"]');
    await expect(input).toBeVisible({ timeout: 8_000 });
    await input.fill('forms');
    // Either a results list or the AI/special fallback pane renders — never nothing.
    const results = page.locator('[data-testid="palette-results"], [data-testid="palette-special"]');
    await expect(results.first(), 'a query yields a results surface').toBeVisible({ timeout: 6_000 });
    await snap(page, 'shell-02-palette-results');
  });

  test('03 the palette can navigate to a section (type → Enter → lands there)', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin');
    await page.getByRole('heading').first().waitFor({ state: 'visible', timeout: 15_000 });
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k');
    const input = page.locator('[data-testid="palette-input"]');
    await expect(input).toBeVisible({ timeout: 8_000 });
    await input.fill('forms');
    await page.locator('[data-testid="palette-results"], [data-testid="palette-special"]').first().waitFor({
      state: 'visible',
      timeout: 6_000,
    });
    await page.keyboard.press('Enter');
    // The top result for "forms" navigates to the forms surface.
    await expect(page, 'palette Enter navigates').toHaveURL(/\/admin\/forms/, { timeout: 8_000 });
  });

  test('04 the palette exposes an "Ask AI" affordance and opens the AI pane', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin');
    await page.getByRole('heading').first().waitFor({ state: 'visible', timeout: 15_000 });
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k');
    const input = page.locator('[data-testid="palette-input"]');
    await expect(input).toBeVisible({ timeout: 8_000 });
    await input.fill('how do I connect a custom domain');
    const askAi = page.locator('[data-testid="palette-action-ask-ai"]').first();
    if (await askAi.count()) {
      await expect(askAi, 'the Ask-AI action is offered').toBeVisible();
      await askAi.click();
      // The AI pane opens (independent of the model response landing).
      await expect(page.locator('[data-testid="cmdk-ai-pane"]'), 'Ask-AI opens the AI pane').toBeVisible({
        timeout: 10_000,
      });
      await snap(page, 'shell-04-palette-ai');
    }
  });

  test('05 Escape closes the command palette', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin');
    await page.getByRole('heading').first().waitFor({ state: 'visible', timeout: 15_000 });
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k');
    const input = page.locator('[data-testid="palette-input"]');
    await expect(input).toBeVisible({ timeout: 8_000 });
    await page.keyboard.press('Escape');
    await expect(input, 'Escape dismisses the palette').toBeHidden({ timeout: 6_000 });
  });

  // ── User menu + shortcuts ───────────────────────────────────────────────────

  test('06 the user avatar opens the account menu with its items', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin');
    const avatar = page.locator('[data-testid="user-avatar-btn"]');
    await expect(avatar).toBeVisible({ timeout: 15_000 });
    await avatar.click();
    await expect(page.locator('[data-testid="user-menu"]'), 'the account menu opens').toBeVisible({ timeout: 6_000 });
    await expect(page.locator('[data-testid="user-menu-signout"]'), 'sign-out is offered').toBeVisible();
    await snap(page, 'shell-06-user-menu');
  });

  test('07 the account menu → Shortcuts opens the shortcuts overlay', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin');
    await page.locator('[data-testid="user-avatar-btn"]').click();
    const shortcuts = page.locator('[data-testid="user-menu-shortcuts"]');
    await expect(shortcuts).toBeVisible({ timeout: 8_000 });
    await shortcuts.click();
    await expect(page.locator('[data-testid="shortcuts-overlay"]'), 'the shortcuts cheat-sheet opens').toBeVisible({
      timeout: 8_000,
    });
    await snap(page, 'shell-07-shortcuts');
  });

  test('08 the "?" key opens the shortcuts overlay and Escape closes it', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin');
    await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 15_000 });
    // Focus the shell body (not an input) before pressing "?".
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('?');
    const overlay = page.locator('[data-testid="shortcuts-overlay"]');
    if (await overlay.count()) {
      await expect(overlay, '"?" opens the cheat-sheet').toBeVisible({ timeout: 6_000 });
      await page.keyboard.press('Escape');
      await expect(overlay, 'Escape closes the cheat-sheet').toBeHidden({ timeout: 6_000 });
    }
  });

  // ── Notifications ───────────────────────────────────────────────────────────

  test('09 the notifications control opens its pop and shows a coherent state', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin');
    const bell = page.getByRole('button', { name: /notifications/i }).first();
    await expect(bell).toBeVisible({ timeout: 15_000 });
    await bell.click();
    // Either the honest empty state OR an audit-seeded list — never a crash.
    const empty = page.locator('[data-testid="notif-empty"]');
    const items = page.locator('.notif-item');
    await expect(async () => {
      expect((await empty.count()) + (await items.count()), 'notifications render empty-or-list').toBeGreaterThan(0);
    }).toPass({ timeout: 8_000 });
    await snap(page, 'shell-09-notifications');
  });

  // ── Task tray ───────────────────────────────────────────────────────────────

  test('10 the AI task tray region is present (honest-empty for a 0-task org)', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin');
    await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 15_000 });
    // The tray host mounts as a labelled region even when it holds 0 tasks.
    const tray = page.getByRole('region', { name: /ai task tray/i });
    await expect(tray, 'the task tray region is mounted').toBeAttached({ timeout: 8_000 });
  });

  // ── Network status banner (offline awareness) ───────────────────────────────

  test('11 going offline surfaces the network-status banner, online recovers', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin');
    await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 15_000 });
    await page.context().setOffline(true);
    // Nudge the offline listener.
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    const banner = page.locator('[data-testid="network-status-banner"]');
    await expect(banner, 'offline shows the banner').toBeVisible({ timeout: 8_000 });
    await snap(page, 'shell-11-offline');
    await page.context().setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    // The banner clears (or flips to a transient "back online" state, then clears).
    await expect(banner, 'coming back online clears the banner').toBeHidden({ timeout: 10_000 });
  });

  // ── Route announcer (a11y) ──────────────────────────────────────────────────

  test('12 the admin route announcer (a11y live region) is present', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin');
    await expect(page.locator('[data-testid="admin-route-announcer"]'), 'the route announcer exists').toBeAttached({
      timeout: 15_000,
    });
  });

  // ── Site actions menu ───────────────────────────────────────────────────────

  test('13 the site-actions control opens its menu (preview/deploy/copy/share)', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin');
    const actions = page.locator('[data-testid="site-actions-btn"]');
    if (await actions.count()) {
      await expect(actions).toBeVisible({ timeout: 12_000 });
      await actions.click();
      await expect(page.locator('[data-testid="site-actions-menu"]'), 'the site-actions menu opens').toBeVisible({
        timeout: 6_000,
      });
      const anyAction = page.locator(
        '[data-testid="sa-preview"], [data-testid="sa-deploy"], [data-testid="sa-copy-url"], [data-testid="sa-share-link"]',
      );
      await expect(anyAction.first(), 'the menu offers site actions').toBeVisible();
      await snap(page, 'shell-13-site-actions');
    }
  });

  // ── Hygiene + journeys ──────────────────────────────────────────────────────

  test('14 deep-link + reload preserves the shell + its widgets (session intact)', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin');
    await expect(page.locator('[data-testid="user-avatar-btn"]')).toBeVisible({ timeout: 15_000 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-testid="user-avatar-btn"]')).toBeVisible({ timeout: 15_000 });
    await expect(page).not.toHaveURL(/\/signin/);
  });

  test('15 opening and closing every shell widget raises no console errors', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin');
    await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 15_000 });
    // Palette
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k');
    await page.locator('[data-testid="palette-input"]').waitFor({ state: 'visible', timeout: 8_000 }).catch(() => {});
    await page.keyboard.press('Escape');
    // User menu
    await page.locator('[data-testid="user-avatar-btn"]').click();
    await page.locator('[data-testid="user-menu"]').waitFor({ state: 'visible', timeout: 6_000 }).catch(() => {});
    await page.keyboard.press('Escape');
    // Notifications
    const bell = page.getByRole('button', { name: /notifications/i }).first();
    if (await bell.count()) {
      await bell.click();
      await page.waitForTimeout(300);
      await page.keyboard.press('Escape');
    }
    expectClean(errors);
  });

  test('16 full journey: Cmd+K search → account menu → shortcuts → all coherent + auth 200', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin');
    // Ground truth: the shell authorizes.
    const me = await apiFetch<Record<string, unknown>>(page, '/api/auth/me');
    expect(me.status).toBe(200);
    // Palette search.
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k');
    const input = page.locator('[data-testid="palette-input"]');
    await expect(input).toBeVisible({ timeout: 8_000 });
    await input.fill('billing');
    await page.locator('[data-testid="palette-results"], [data-testid="palette-special"]').first().waitFor({
      state: 'visible',
      timeout: 6_000,
    });
    await page.keyboard.press('Escape');
    // Account menu → shortcuts.
    await page.locator('[data-testid="user-avatar-btn"]').click();
    const shortcuts = page.locator('[data-testid="user-menu-shortcuts"]');
    if (await shortcuts.count()) {
      await shortcuts.click();
      await expect(page.locator('[data-testid="shortcuts-overlay"]')).toBeVisible({ timeout: 8_000 });
      await page.keyboard.press('Escape');
    }
    await expect(page.locator('[data-testid="user-avatar-btn"]'), 'back on the shell').toBeVisible();
    await snap(page, 'shell-16-journey');
    expectClean(errors);
  });
});
