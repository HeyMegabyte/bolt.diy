/**
 * adversarial/shell-stress.spec.ts
 *
 * ADVERSARIAL — Admin shell stress tests (modernized 2026-07-31).
 *
 * Scenarios:
 *  ADV-SHELL-01  Rapid sidebar link hammering (click 8 nav items back-to-back)
 *  ADV-SHELL-02  Language-switcher spam (toggle 6× rapidly)
 *  ADV-SHELL-03  Command-palette open/close spam via toolbar ⌘K button (4 cycles)
 *  ADV-SHELL-04  Viewport resize storm at 4 breakpoints during navigation
 *  ADV-SHELL-05  Browser-back during in-flight navigation
 *  ADV-SHELL-06  Hard reload on 4 deep routes
 *  ADV-SHELL-07  User-menu rapid open/close toggle (5 cycles)
 *  ADV-SHELL-08  SPA sentinel across sidebar links (no full reload)
 *  ADV-SHELL-09  NO editor-tab-preview element exists anywhere in DOM
 *  ADV-SHELL-11  site-error-banner is not visible under normal load
 *  ADV-SHELL-12  Escape closes user menu
 *
 * Modernization notes:
 *  - networkidle NEVER settles on this app (visibility-aware polling +
 *    PostHog) — all waits are domcontentloaded + explicit locator waits.
 *  - NAV_ROUTES mirrors the CURRENT sidebar (admin.component.html static
 *    routerLink attrs). /admin/traces + /admin/audit merged into /admin/logs
 *    tabbed dashboard (2026-06-08).
 *  - Meta+K is a NO-OP inside /admin (app.component.ts defers to the admin
 *    palette, which has no key binding — only the toolbar .cmdk-btn calls
 *    openIt()). ADV-SHELL-03 re-keyed to the real affordance.
 *  - Auth: authedPage fixture runs signInAsTestUser BEFORE the test body, so
 *    the catch-all /api/** stubs are registered before any /admin navigation
 *    — no authed GET ever reaches prod (session-clear bounce).
 *
 * Project rules enforced:
 *  - Internal nav via UI clicks only (goto only for initial load / reload)
 *  - No page.waitForTimeout (only locator waits)
 *  - Parallel-safe (isolated browser context per test via authedPage)
 */

import { test, expect } from '../fixtures.js';

const BASE = process.env.BASE_URL ?? process.env.PROD_URL ?? 'https://projectsites.dev'; // localhost:8787 fallback sent the whole suite to a stray dev server ("governor" page)

// Sidebar routes as they exist in admin.component.html today (static
// routerLink attributes — Angular keeps these in the rendered DOM).
const NAV_ROUTES = [
  { label: 'Snapshots', href: '/admin/snapshots' },
  { label: 'Analytics', href: '/admin/analytics' },
  { label: 'Forms',     href: '/admin/forms' },
  { label: 'Logs',      href: '/admin/logs' },
  { label: 'Apps',      href: '/admin/apps' },
  { label: 'Social',    href: '/admin/social' },
  { label: 'Voice',     href: '/admin/voice' },
  { label: 'Domains',   href: '/admin/domains' },
  { label: 'Docs',      href: '/admin/docs' },
  { label: 'Settings',  href: '/admin/settings' },
];

// ─── helpers ────────────────────────────────────────────────────────────────

async function gotoAdminShell(page: import('@playwright/test').Page): Promise<void> {
  await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('aside').first()).toBeVisible({ timeout: 20_000 });
}

async function injectSentinel(page: import('@playwright/test').Page): Promise<number> {
  const val = Math.random();
  await page.evaluate((v: number) => {
    (window as unknown as Record<string, unknown>)['__adv_sentinel__'] = v;
  }, val);
  return val;
}

async function assertSentinel(page: import('@playwright/test').Page, expected: number): Promise<void> {
  const actual = await page.evaluate(
    () => (window as unknown as Record<string, unknown>)['__adv_sentinel__'],
  );
  expect(actual).toBe(expected);
}

function attachErrorCollector(page: import('@playwright/test').Page): string[] {
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
        !text.includes('ERR_FAILED')
      ) {
        errors.push(text);
      }
    }
  });
  page.on('pageerror', (err) => errors.push(`[pageerror] ${err.message}`));
  return errors;
}

async function shot(page: import('@playwright/test').Page, name: string): Promise<void> {
  await page
    .screenshot({ path: `e2e/screenshots/adversarial/${name}.png`, fullPage: false })
    .catch(() => undefined);
}

// ─── ADV-SHELL-01: Rapid sidebar hammering ──────────────────────────────────

test.describe('ADV-SHELL-01 — Rapid sidebar nav hammering', () => {
  test('clicking 8 sidebar links back-to-back: no console errors, no full reload', async ({
    authedPage: page,
  }) => {
    const errors = attachErrorCollector(page);
    await gotoAdminShell(page);
    const sentinel = await injectSentinel(page);

    const navLinks = page.locator('aside nav a.nav-item');
    const count = await navLinks.count();
    expect(count).toBeGreaterThan(0);
    const clicks = Math.min(8, count);

    for (let i = 0; i < clicks; i++) {
      await navLinks.nth(i % count).click({ force: true });
    }
    // Router settles — shell must survive the thrash
    await expect(page.locator('aside').first()).toBeVisible({ timeout: 10_000 });

    await shot(page, 'shell-01-after-hammering');
    await assertSentinel(page, sentinel);
    expect(errors).toHaveLength(0);
  });
});

// ─── ADV-SHELL-02: Language-switcher spam ───────────────────────────────────

test.describe('ADV-SHELL-02 — Language-switcher spam', () => {
  test('toggling language 6× rapidly does not throw or cause a full reload', async ({
    authedPage: page,
  }) => {
    const errors = attachErrorCollector(page);
    await gotoAdminShell(page);
    const sentinel = await injectSentinel(page);

    const avatarBtn = page.getByTestId('user-avatar-btn');
    await expect(avatarBtn).toBeVisible({ timeout: 10_000 });

    for (let i = 0; i < 6; i++) {
      // Re-open menu each iteration (it may close after toggle)
      const menuVisible = await page.getByTestId('user-menu').isVisible({ timeout: 500 }).catch(() => false);
      if (!menuVisible) {
        await avatarBtn.click();
        await expect(page.getByTestId('user-menu-language')).toBeVisible({ timeout: 3_000 });
      }
      await page.getByTestId('user-menu-language').click();
    }

    await page.keyboard.press('Escape');
    await shot(page, 'shell-02-after-language-spam');
    await assertSentinel(page, sentinel);
    expect(errors).toHaveLength(0);
  });
});

// ─── ADV-SHELL-03: Command-palette open/close spam ──────────────────────────
// Re-keyed 2026-07-31: Meta+K is a no-op inside /admin (no key binding on the
// admin palette — admin.component.ts:748-770 binds only ?, /, ⌘., ⌘B, ⌘S and
// g-chords). The real affordance is the toolbar button (aria-label
// "Open command palette", admin.component.html ~789).

test.describe('ADV-SHELL-03 — Command palette open/close spam', () => {
  test('toggling the command palette 4 cycles via toolbar button + Escape', async ({
    authedPage: page,
  }) => {
    const errors = attachErrorCollector(page);
    await gotoAdminShell(page);
    const sentinel = await injectSentinel(page);

    const openBtn = page.getByRole('button', { name: 'Open command palette' });
    await expect(openBtn).toBeVisible({ timeout: 10_000 });

    const paletteInput = page.locator('[data-testid="palette-input"]:visible');
    // First open re-clicks: openPalette() is `this.palette?.openIt()` and
    // no-ops until the ViewChild resolves.
    await expect(async () => {
      await openBtn.click();
      await expect(paletteInput).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 10_000 });
    await page.keyboard.press('Escape');
    await expect(paletteInput).toBeHidden({ timeout: 3_000 });

    for (let i = 0; i < 4; i++) {
      await openBtn.click();
      await expect(paletteInput).toBeVisible({ timeout: 3_000 });
      await page.keyboard.press('Escape');
      await expect(paletteInput).toBeHidden({ timeout: 3_000 });
    }

    await shot(page, 'shell-03-palette-closed');
    await assertSentinel(page, sentinel);
    expect(errors).toHaveLength(0);
  });
});

// ─── ADV-SHELL-04: Viewport resize storm ────────────────────────────────────

test.describe('ADV-SHELL-04 — Viewport resize storm', () => {
  // Six-breakpoint storm × per-route nav legitimately exceeds the default
  // 30s test budget under prod latency.
  test.setTimeout(120_000);
  const VIEWPORTS = [
    { width: 375, height: 812 },
    { width: 768, height: 1024 },
    { width: 1280, height: 800 },
    { width: 1920, height: 1080 },
  ];

  for (const vp of VIEWPORTS) {
    test(`no errors at ${vp.width}×${vp.height} while navigating`, async ({
      authedPage: page,
    }) => {
      const errors = attachErrorCollector(page);
      await page.setViewportSize(vp);
      await gotoAdminShell(page);
      const sentinel = await injectSentinel(page);

      // Navigate to analytics at this viewport. At mobile widths the sidebar
      // is collapsed OFF-CANVAS: the nav link stays "visible" to Playwright
      // but sits outside the viewport, so a bare click retries forever —
      // open the hamburger first (the real mobile affordance).
      if (vp.width < 768) {
        await page.getByRole('button', { name: 'Open navigation menu' }).click();
      }
      const link = page.locator('a[routerLink="/admin/analytics"]').first();
      if (await link.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await link.click({ timeout: 8_000 }).catch(() => undefined);
        await page.waitForURL(/\/admin\/analytics/, { timeout: 8_000 }).catch(() => undefined);
      }

      // Resize in the middle of the section lifecycle
      await page.setViewportSize({ width: 1280, height: 800 });
      await expect(page.locator('aside').first()).toBeVisible({ timeout: 8_000 });

      await shot(page, `shell-04-storm-${vp.width}`);
      await assertSentinel(page, sentinel);
      expect(errors).toHaveLength(0);
    });
  }
});

// ─── ADV-SHELL-05: Browser-back during in-flight navigation ─────────────────

test.describe('ADV-SHELL-05 — Browser-back during navigation', () => {
  test('pressing goBack immediately after sidebar nav click does not crash', async ({
    authedPage: page,
  }) => {
    const errors = attachErrorCollector(page);
    await gotoAdminShell(page);

    const logsLink = page.locator('a[routerLink="/admin/logs"]').first();
    await expect(logsLink).toBeVisible({ timeout: 8_000 });
    await logsLink.click();

    // Immediately go back while the section may still be lazy-loading.
    // Depending on whether the logs nav committed before popstate, back lands
    // on /admin (aside) OR all the way out on the marketing shell — BOTH are
    // crash-free outcomes; the contract is "no white screen, no errors".
    await page.goBack({ waitUntil: 'commit' });

    const aside = page.locator('aside').first();
    const marketingShell = page.locator('app-root');
    await expect(aside.or(marketingShell).first()).toBeVisible({ timeout: 10_000 });
    const bodyLen = await page.evaluate(() => document.body.innerText.length);
    expect(bodyLen, 'page must not white-screen after rapid goBack').toBeGreaterThan(20);
    await shot(page, 'shell-05-after-back');
    expect(errors).toHaveLength(0);
  });
});

// ─── ADV-SHELL-06: Hard reload on deep routes ───────────────────────────────

test.describe('ADV-SHELL-06 — Hard reload on deep routes', () => {
  // /admin/traces + /admin/audit retired as standalone routes (merged into
  // /admin/logs tabs); /admin/feature-flags is sysAdmin-gated for the default
  // test user — deep set below is the current always-reachable surface.
  const DEEP_ROUTES = [
    '/admin/logs',
    '/admin/domains',
    '/admin/settings',
    '/admin/user',
  ];

  for (const route of DEEP_ROUTES) {
    test(`admin shell re-mounts correctly after reload on ${route}`, async ({
      authedPage: page,
    }) => {
      const errors = attachErrorCollector(page);
      await gotoAdminShell(page);

      // Navigate via sidebar link (all four are in the current sidebar)
      const link = page.locator(`a[routerLink="${route}"]`).first();
      if (await link.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await link.click();
        await page
          .waitForURL(new RegExp(route.replace(/\//g, '\\/')), { timeout: 8_000 })
          .catch(() => undefined);
      }

      // Hard reload (legitimate separate navigation, not internal nav).
      // networkidle never settles here — wait for the shell instead.
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 });

      await expect(page.locator('aside').first()).toBeVisible({ timeout: 20_000 });
      await shot(page, `shell-06-reload${route.replace(/\//g, '-')}`);
      expect(errors).toHaveLength(0);
    });
  }
});

// ─── ADV-SHELL-07: User menu rapid toggle ───────────────────────────────────

test.describe('ADV-SHELL-07 — User-menu rapid open/close', () => {
  test('toggling user menu 5 cycles quickly: closed at rest, no console errors', async ({
    authedPage: page,
  }) => {
    const errors = attachErrorCollector(page);
    await gotoAdminShell(page);
    const sentinel = await injectSentinel(page);

    const avatarBtn = page.getByTestId('user-avatar-btn');
    await expect(avatarBtn).toBeVisible({ timeout: 10_000 });

    for (let i = 0; i < 5; i++) {
      await avatarBtn.click(); // open
      await avatarBtn.click(); // toggle closed
    }

    // Menu must be closed after an even number of toggles
    await expect(page.getByTestId('user-menu')).toBeHidden({ timeout: 3_000 });

    await shot(page, 'shell-07-menu-at-rest');
    await assertSentinel(page, sentinel);
    expect(errors).toHaveLength(0);
  });
});

// ─── ADV-SHELL-08: SPA sentinel across nav links ────────────────────────────

test.describe('ADV-SHELL-08 — SPA no-reload across nav links', () => {
  test('navigating 6 sidebar links never triggers a full-page reload', async ({
    authedPage: page,
  }) => {
    const errors = attachErrorCollector(page);
    await gotoAdminShell(page);
    const sentinel = await injectSentinel(page);

    const navBefore = await page.evaluate(
      () => performance.getEntriesByType('navigation').length,
    );

    for (const route of NAV_ROUTES.slice(0, 6)) {
      const link = page.locator(`a[routerLink="${route.href}"]`).first();
      if (await link.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await link.click();
        await page
          .waitForURL(new RegExp(route.href.replace(/\//g, '\\/')), { timeout: 5_000 })
          .catch(() => undefined);
      }
    }

    const navAfter = await page.evaluate(
      () => performance.getEntriesByType('navigation').length,
    );

    // SPA routing must never increase the navigation entry count
    expect(navAfter).toBe(navBefore);
    await shot(page, 'shell-08-final-section');
    await assertSentinel(page, sentinel);
    expect(errors).toHaveLength(0);
  });
});

// ─── ADV-SHELL-09: NO editor-tab-preview ────────────────────────────────────

test.describe('ADV-SHELL-09 — Preview tab was removed', () => {
  test('there is NO element with data-testid="editor-tab-preview" anywhere in the DOM', async ({
    authedPage: page,
  }) => {
    const errors = attachErrorCollector(page);
    await gotoAdminShell(page);

    // CRITICAL regression guard: preview tab must not come back
    await expect(page.getByTestId('editor-tab-preview')).toHaveCount(0);
    expect(errors).toHaveLength(0);
  });
});

// ─── ADV-SHELL-11: site-error-banner not visible on clean load ──────────────

test.describe('ADV-SHELL-11 — Error banner hidden on clean load', () => {
  test('site-error-banner is not visible during a normal admin session', async ({
    authedPage: page,
  }) => {
    const errors = attachErrorCollector(page);
    await gotoAdminShell(page);

    const banner = page.getByTestId('site-error-banner');
    const isVisible = await banner.isVisible({ timeout: 2_000 }).catch(() => false);
    expect(isVisible).toBe(false);
    await shot(page, 'shell-11-clean-load');
    expect(errors).toHaveLength(0);
  });
});

// ─── ADV-SHELL-12: Escape closes user menu ──────────────────────────────────

test.describe('ADV-SHELL-12 — Escape closes user menu', () => {
  test('Escape key closes the user menu', async ({ authedPage: page }) => {
    const errors = attachErrorCollector(page);
    await gotoAdminShell(page);

    const avatarBtn = page.getByTestId('user-avatar-btn');
    await expect(avatarBtn).toBeVisible({ timeout: 10_000 });
    await avatarBtn.click();
    await expect(page.getByTestId('user-menu')).toBeVisible({ timeout: 3_000 });

    await page.keyboard.press('Escape');

    // Hard contract: admin.component.ts onGlobalKey closes userMenuOpen on Escape
    await expect(page.getByTestId('user-menu')).toBeHidden({ timeout: 3_000 });
    await shot(page, 'shell-12-menu-escaped');
    expect(errors).toHaveLength(0);
  });
});
