/**
 * CHAOS 10 — "The Fidgety Admin": the top-bar overlay controls.
 *
 * chaos-4 sweeps every admin SECTION route + deep CRUD, but never the admin
 * shell's top-bar chrome: the three header dropdowns (Site actions, Notifications
 * bell, Account menu). A real admin opens these constantly, Escapes out, and
 * flicks between them. This journey exercises exactly that:
 *   open → popover renders real content → aria-expanded flips true → Esc closes
 *   it (aria-expanded flips back) → opening one closes the others (mutual excl).
 * Full console/pageerror/5xx DoD across the whole flow (mission = 0 app errors).
 *
 * Verified live fire-35 (2026-08-17): all three render real content + Esc-close
 * + zero console errors; this locks that in so a future regression is caught.
 *
 * Run: E2E_API_KEY=$(get-secret E2E_API_KEY) npx playwright test \
 *   --config=playwright.prod.config.ts chaos-10-admin-header-overlays
 *
 * ⚠️ Reads shell state only — never edits the admin-shell files a concurrent
 * session owns. Targets the shipped data-testid / aria-label selectors.
 */
import { test, expect, type Page } from '@playwright/test';
import { trackErrors, assertAlive, seedAuth } from './chaos-helpers';

const KEY = process.env.E2E_API_KEY ?? '';

// The three top-bar overlays, by their shipped selectors (admin.component.html):
//  - Site actions: [data-testid="site-actions-btn"] → [data-testid="site-actions-menu"]
//  - Notifications: button[aria-label="Notifications"] → .notif-pop
//  - Account:      [data-testid="user-avatar-btn"]   → [data-testid="user-menu"]
interface Overlay {
  readonly name: string;
  readonly trigger: string;
  readonly pop: string;
}
const OVERLAYS: readonly Overlay[] = [
  { name: 'site-actions', trigger: '[data-testid="site-actions-btn"]', pop: '[data-testid="site-actions-menu"]' },
  { name: 'notifications', trigger: 'button[aria-label="Notifications"]', pop: '.notif-pop' },
  { name: 'account', trigger: '[data-testid="user-avatar-btn"]', pop: '[data-testid="user-menu"]' },
];

async function gotoAdmin(page: Page): Promise<void> {
  await seedAuth(page, KEY);
  await page.goto('/admin', { waitUntil: 'domcontentloaded' });
  // Condition-based: wait for the account avatar (always present in the authed
  // top bar) rather than a blind sleep — proves the shell hydrated.
  await expect(page.locator('[data-testid="user-avatar-btn"]').first()).toBeVisible({
    timeout: 20_000,
  });
}

test.describe('CHAOS 10 — Admin header overlays (site actions / notifications / account)', () => {
  test.beforeEach(() => {
    test.skip(!KEY, 'E2E_API_KEY not set');
  });

  test('each top-bar overlay opens, renders content, aria-expanded toggles, Esc closes — console-clean', async ({
    page,
  }) => {
    const e = trackErrors(page);
    await gotoAdmin(page);

    for (const o of OVERLAYS) {
      const trigger = page.locator(o.trigger).first();
      // The Site-actions button only renders when a site is selected; the E2E org
      // has a site (chaos-4 relies on this), so all three MUST be reachable.
      await expect(trigger, `${o.name} trigger present`).toBeVisible({ timeout: 10_000 });
      await expect(trigger, `${o.name} starts collapsed`).toHaveAttribute('aria-expanded', 'false');

      // Open → aria-expanded flips true AND a real popover paints with content.
      await trigger.click();
      await expect(trigger, `${o.name} expands on click`).toHaveAttribute('aria-expanded', 'true', {
        timeout: 5000,
      });
      const pop = page.locator(o.pop).first();
      await expect(pop, `${o.name} popover renders`).toBeVisible({ timeout: 5000 });
      const text = (await pop.innerText().catch(() => '')).trim();
      expect(text.length, `${o.name} popover shows real content, not an empty shell`).toBeGreaterThan(
        2,
      );

      // Esc closes it (admin.component keydown.escape handler) → collapsed again.
      await page.keyboard.press('Escape');
      await expect(trigger, `${o.name} collapses on Esc`).toHaveAttribute('aria-expanded', 'false', {
        timeout: 5000,
      });
      await expect(pop, `${o.name} popover hidden after Esc`).toBeHidden({ timeout: 5000 });
    }

    await assertAlive(page);
    expect(await e.xssFired(), 'no injected script fired across the overlay flow').toBe(false);
    expect(e.pageErrors, `pageerrors: ${e.pageErrors.join('; ')}`).toEqual([]);
    expect(e.serverErrors, `5xx: ${e.serverErrors.join('; ')}`).toEqual([]);
    expect(e.consoleErrors, `console errors: ${e.consoleErrors.join('; ')}`).toEqual([]);
    expect(e.consoleWarnings, `console warnings (DoD=0): ${e.consoleWarnings.join('; ')}`).toEqual(
      [],
    );
  });

  test('opening one overlay closes the others (mutual exclusivity — no two open at once)', async ({
    page,
  }) => {
    const e = trackErrors(page);
    await gotoAdmin(page);

    const expanded = (sel: string) =>
      page
        .locator(sel)
        .first()
        .getAttribute('aria-expanded');

    // Open site-actions, then account: account opens, site-actions must close.
    await page.locator('[data-testid="site-actions-btn"]').first().click();
    await expect(page.locator('[data-testid="site-actions-menu"]').first()).toBeVisible({
      timeout: 5000,
    });

    await page.locator('[data-testid="user-avatar-btn"]').first().click();
    await expect(page.locator('[data-testid="user-menu"]').first()).toBeVisible({ timeout: 5000 });
    expect(await expanded('[data-testid="site-actions-btn"]'), 'site-actions closed when account opened').toBe(
      'false',
    );

    // Now open notifications: account must close.
    await page.locator('button[aria-label="Notifications"]').first().click();
    await expect(page.locator('.notif-pop').first()).toBeVisible({ timeout: 5000 });
    expect(await expanded('[data-testid="user-avatar-btn"]'), 'account closed when notifications opened').toBe(
      'false',
    );

    // Exactly one open at the end.
    const openCount =
      Number((await expanded('[data-testid="site-actions-btn"]')) === 'true') +
      Number((await expanded('[data-testid="user-avatar-btn"]')) === 'true') +
      Number((await expanded('button[aria-label="Notifications"]')) === 'true');
    expect(openCount, 'exactly one overlay open after flicking between all three').toBe(1);

    await assertAlive(page);
    expect(e.pageErrors, `pageerrors: ${e.pageErrors.join('; ')}`).toEqual([]);
    expect(e.serverErrors, `5xx: ${e.serverErrors.join('; ')}`).toEqual([]);
    expect(e.consoleErrors, `console errors: ${e.consoleErrors.join('; ')}`).toEqual([]);
  });
});
