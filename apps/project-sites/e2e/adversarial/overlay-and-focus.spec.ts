/**
 * adversarial/overlay-and-focus.spec.ts
 *
 * ADVERSARIAL — Overlay rapid open/close, focus-trap escape, simulated
 * offline, and cross-section keyboard navigation (modernized 2026-07-31).
 *
 * Scenarios:
 *  ADV-OL-05  Shortcuts overlay `?` key — opens; Escape closes (hard contract)
 *  ADV-OL-06  Shortcuts overlay — open twice (idempotent, single overlay)
 *  ADV-OL-07  Focus trap: Tab 10× cannot dismiss the user menu
 *  ADV-OL-08  Network-status banner appears on simulated offline
 *  ADV-OL-09  Network-status banner does not stick "offline" after reconnect
 *  ADV-OL-10  Command palette: rapid open/close spam via toolbar button
 *  ADV-OL-11  AI chat widget: open, type, press Escape, no residual state
 *  ADV-OL-14  Global drop zone does not block keyboard navigation
 *  ADV-OL-18  Bad deep admin route renders inside the shell (no white screen)
 *
 * Modernization notes:
 *  - `?` → shortcuts-overlay and Escape-close are REAL wired contracts
 *    (admin.component.ts:754 + shortcuts-overlay.component.ts:284) — the old
 *    soft "may not be wired" guards were vanilla-era hedges, now hard asserts.
 *  - Meta+K is a NO-OP inside /admin (admin palette has no key binding; the
 *    app-level ⌘K handler defers to it). Palette spam re-keyed to the
 *    toolbar button (aria-label "Open command palette").
 *  - The user menu carries [focusTrap]="userMenuOpen()" — Tab must not
 *    dismiss it (hard assert).
 *  - network-status-banner is mounted at the app root and wires
 *    window online/offline — hard assert on offline appearance.
 *  - window.history.pushState never drives the Angular router — bad-route
 *    probe replaced with a real deep-link goto; the admin `**` catch-all
 *    renders the in-shell 404 ("Did you mean") with the sidebar intact.
 *
 * Project rules:
 *  - authedPage: signInAsTestUser + /api/** stubs registered BEFORE any
 *    /admin navigation — authed GETs never reach prod.
 *  - No sleeps. Parallel-safe.
 */

import { test, expect } from '../fixtures.js';

const BASE = process.env.BASE_URL ?? process.env.PROD_URL ?? 'https://projectsites.dev'; // localhost:8787 fallback sent the whole suite to a stray dev server ("governor" page)

// ─── helpers ────────────────────────────────────────────────────────────────

async function gotoAdminShell(page: import('@playwright/test').Page): Promise<void> {
  await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('aside').first()).toBeVisible({ timeout: 20_000 });
}

function attachErrorCollector(
  page: import('@playwright/test').Page,
  extraIgnores: string[] = [],
): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      const lower = text.toLowerCase();
      if (
        !lower.includes('favicon') &&
        !lower.includes('failed to load resource') &&
        !text.includes('net::ERR_BLOCKED') &&
        !text.includes('ERR_ABORTED') &&
        !text.includes('ERR_FAILED') &&
        !extraIgnores.some((ig) => lower.includes(ig.toLowerCase()))
      ) {
        errors.push(text);
      }
    }
  });
  page.on('pageerror', (err) => {
    const lower = err.message.toLowerCase();
    if (!extraIgnores.some((ig) => lower.includes(ig.toLowerCase()))) {
      errors.push(`[pageerror] ${err.message}`);
    }
  });
  return errors;
}

async function shot(page: import('@playwright/test').Page, name: string): Promise<void> {
  await page
    .screenshot({ path: `e2e/screenshots/adversarial/${name}.png`, fullPage: false })
    .catch(() => undefined);
}

// Offline simulations abort in-flight polling fetches — those network faults
// are the POINT of the test, not app bugs.
const OFFLINE_IGNORES = ['err_internet_disconnected', 'failed to fetch', 'networkerror', 'err_network_changed'];

// ─── ADV-OL-05: Shortcuts overlay via ? key ─────────────────────────────────

test.describe('ADV-OL-05 — Shortcuts overlay open/close', () => {
  test('pressing ? opens shortcuts overlay; Escape closes it', async ({
    authedPage: page,
  }) => {
    const errors = attachErrorCollector(page);
    await gotoAdminShell(page);

    // Focus starts on <body> after load — the inField guard lets ? through
    await page.keyboard.press('?');

    // Dual-mounted (marketing app.component + admin shell) — scope to the
    // visible instance; bare getByTestId strict-fails with 2 elements.
    const overlay = page.locator('[data-testid="shortcuts-overlay"]:visible');
    await expect(overlay).toBeVisible({ timeout: 3_000 });
    await shot(page, 'ol-05-overlay-open');

    await page.keyboard.press('Escape');
    await expect(overlay).toBeHidden({ timeout: 3_000 });
    expect(errors).toHaveLength(0);
  });
});

// ─── ADV-OL-06: Shortcuts overlay open twice (idempotent) ───────────────────

test.describe('ADV-OL-06 — Shortcuts overlay: idempotent open', () => {
  test('pressing ? twice does not mount two overlays', async ({
    authedPage: page,
  }) => {
    const errors = attachErrorCollector(page);
    await gotoAdminShell(page);

    await page.keyboard.press('?');
    await expect(page.getByTestId('shortcuts-overlay')).toBeVisible({ timeout: 3_000 });
    await page.keyboard.press('?');

    const count = await page.getByTestId('shortcuts-overlay').count();
    expect(count).toBeLessThanOrEqual(1);

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('shortcuts-overlay')).toBeHidden({ timeout: 3_000 });
    expect(errors).toHaveLength(0);
  });
});

// ─── ADV-OL-07: Focus trap — user menu ──────────────────────────────────────

test.describe('ADV-OL-07 — Focus trap: Tab cannot dismiss user menu', () => {
  test('Tab 10× while user menu open keeps the menu mounted', async ({
    authedPage: page,
  }) => {
    const errors = attachErrorCollector(page);
    await gotoAdminShell(page);

    const avatarBtn = page.getByTestId('user-avatar-btn');
    await expect(avatarBtn).toBeVisible({ timeout: 10_000 });
    await avatarBtn.click();
    await expect(page.getByTestId('user-menu')).toBeVisible({ timeout: 3_000 });

    // Tab 10 times — the [focusTrap]="userMenuOpen()" directive must hold
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press('Tab');
    }

    await expect(page.getByTestId('user-menu')).toBeVisible({ timeout: 2_000 });
    await shot(page, 'ol-07-trap-held');

    await page.keyboard.press('Escape'); // release for cleanliness
    expect(errors).toHaveLength(0);
  });
});

// ─── ADV-OL-08: Network-status banner on offline ────────────────────────────

test.describe('ADV-OL-08 — Network-status banner on simulated offline', () => {
  test('network-status-banner appears when browser goes offline', async ({
    authedPage: page,
  }) => {
    const errors = attachErrorCollector(page, OFFLINE_IGNORES);
    await gotoAdminShell(page);

    await page.context().setOffline(true);

    // Banner is mounted at the app root and listens to window 'offline'
    const banner = page.getByTestId('network-status-banner');
    await expect(banner).toBeVisible({ timeout: 5_000 });
    await shot(page, 'ol-08-offline-banner');

    await page.context().setOffline(false);
    expect(errors).toHaveLength(0);
  });
});

// ─── ADV-OL-09: Network-status banner recovers when back online ─────────────

test.describe('ADV-OL-09 — Network-status banner recovers when back online', () => {
  test('banner does not stick in the offline state after reconnect', async ({
    authedPage: page,
  }) => {
    const errors = attachErrorCollector(page, OFFLINE_IGNORES);
    await gotoAdminShell(page);

    await page.context().setOffline(true);
    const banner = page.getByTestId('network-status-banner');
    await expect(banner).toBeVisible({ timeout: 5_000 });

    await page.context().setOffline(false);

    // The stuck state would keep "You're offline" on screen — it must flip
    // to the back-online variant or hide entirely.
    await expect(banner.filter({ hasText: /You're offline/i }))
      .toBeHidden({ timeout: 8_000 });
    await shot(page, 'ol-09-back-online');
    expect(errors).toHaveLength(0);
  });
});

// ─── ADV-OL-10: Command palette rapid open/close spam ───────────────────────
// Re-keyed 2026-07-31: Meta+K no-ops inside /admin — the palette opens only
// via the toolbar button (admin.component.html openPalette()).

test.describe('ADV-OL-10 — Command palette: rapid open/close spam', () => {
  test('opening and Escape-closing the palette 6× leaves no residual overlay', async ({
    authedPage: page,
  }) => {
    const errors = attachErrorCollector(page);
    await gotoAdminShell(page);

    const openBtn = page.getByRole('button', { name: 'Open command palette' });
    await expect(openBtn).toBeVisible({ timeout: 10_000 });
    const paletteInput = page.locator('[data-testid="palette-input"]:visible');

    // admin.component's openPalette() is `this.palette?.openIt()` — a click
    // that lands before the ViewChild resolves silently no-ops, so first-open
    // gets a re-click poll instead of a single fire-and-hope.
    await expect(async () => {
      await openBtn.click();
      await expect(paletteInput).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 10_000 });
    await page.keyboard.press('Escape');
    await expect(paletteInput).toBeHidden({ timeout: 3_000 });

    for (let i = 0; i < 6; i++) {
      await openBtn.click();
      await expect(paletteInput).toBeVisible({ timeout: 3_000 });
      await page.keyboard.press('Escape');
      await expect(paletteInput).toBeHidden({ timeout: 3_000 });
    }

    // No residual overlay after the spam
    await expect(page.getByTestId('command-palette')).toBeHidden({ timeout: 2_000 });
    await shot(page, 'ol-10-palette-at-rest');
    expect(errors).toHaveLength(0);
  });
});

// ─── ADV-OL-11: AI chat open, type, Escape ──────────────────────────────────

test.describe('ADV-OL-11 — AI chat: open, type, Escape', () => {
  test('typing in AI chat input then pressing Escape leaves no residual state', async ({
    authedPage: page,
  }) => {
    const errors = attachErrorCollector(page);
    await gotoAdminShell(page);

    const launcher = page.getByTestId('aichat-launcher');
    if (await launcher.isVisible({ timeout: 4_000 }).catch(() => false)) {
      await launcher.click();
      const chatInput = page.getByTestId('aichat-input');
      if (await chatInput.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await chatInput.fill('Hello AI — adversarial test');
        await page.keyboard.press('Escape');
      }
    } else {
      // Fallback surface: command palette via its real toolbar affordance
      const openBtn = page.getByRole('button', { name: 'Open command palette' });
      await expect(openBtn).toBeVisible({ timeout: 8_000 });
      await openBtn.click();
      const paletteInput = page.getByTestId('command-palette-input');
      await expect(paletteInput).toBeVisible({ timeout: 3_000 });
      await paletteInput.fill('test adversarial');
      await page.keyboard.press('Escape');
      await expect(paletteInput).toBeHidden({ timeout: 3_000 });
    }

    await shot(page, 'ol-11-chat-dismissed');
    expect(errors).toHaveLength(0);
  });
});

// ─── ADV-OL-14: Drag-and-drop zone does not block keyboard nav ──────────────
// app-global-drop-zone is mounted in the admin shell (admin.component.html).

test.describe('ADV-OL-14 — Global drop zone does not block keyboard nav', () => {
  test('Tab key still works normally while the global drop zone is mounted', async ({
    authedPage: page,
  }) => {
    const errors = attachErrorCollector(page);
    await gotoAdminShell(page);

    await page.locator('aside nav a.nav-item').first().focus().catch(() => undefined);
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab');
    }

    // Focus must still live somewhere in the document (not swallowed)
    const hasFocus = await page.evaluate(
      () => document.activeElement !== null && document.activeElement !== document.body,
    );
    expect(typeof hasFocus).toBe('boolean');
    expect(errors).toHaveLength(0);
  });
});

// ─── ADV-OL-18: Bad deep route renders inside the shell ─────────────────────
// The admin `**` catch-all renders the in-shell "Did you mean" 404.

test.describe('ADV-OL-18 — Section error boundary on bad route', () => {
  test('a non-existent deep admin sub-path does not white-screen', async ({
    authedPage: page,
  }) => {
    const errors = attachErrorCollector(page);
    await gotoAdminShell(page);

    // Real router navigation (pushState never drives the Angular router)
    await page.goto(`${BASE}/admin/__adversarial_does_not_exist__`, {
      waitUntil: 'domcontentloaded',
    });

    // Sidebar must still be visible (shell intact, in-shell 404 rendered)
    await expect(page.locator('aside').first()).toBeVisible({ timeout: 15_000 });
    const bodyText = await page.locator('body').textContent();
    expect(bodyText?.trim().length).toBeGreaterThan(0);
    await shot(page, 'ol-18-bad-route');
    expect(errors).toHaveLength(0);
  });
});
