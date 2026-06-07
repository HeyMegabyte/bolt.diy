/**
 * @module e2e/admin-logo-console-editor
 *
 * Dev-suite (mock-server) gate for the admin-shell cleanup:
 *   1. The projectsites.dev logo is REMOVED from the admin sidebar — the nav
 *      uses the full sidebar width and renders flush at the top.
 *   2. Core routes (admin shell + editor + marketing) load with a CLEAN
 *      console: zero uncaught JS exceptions, zero non-benign console errors
 *      from OUR origin.
 *   3. The bolt.diy editor surface mounts (tab strip + persistent iframe).
 *
 * Runs against the local mock server (`scripts/e2e_server.cjs`) via
 * `playwright.config.ts` — no secrets required, so it passes locally + in CI.
 * Auth uses the canonical `brian@megabyte.space` stub from `fixtures.ts`.
 *
 * "Clean console" mirrors the prod `admin-console-errors.e2e.ts` allowlist:
 * cross-origin editor-iframe noise + browser "Failed to load resource: 4xx"
 * network logs + the webcontainer embedded-mode notice are benign. A real
 * CSP / Trusted-Types / thrown app error from our origin fails the test.
 */
import { test, expect } from './fixtures';
import type { Page, ConsoleMessage } from '@playwright/test';

/** True when a console error is a known-benign artifact, NOT a real app defect. */
function isBenign(msg: ConsoleMessage): boolean {
  const text = msg.text();
  const url = msg.location()?.url ?? '';
  // Cross-origin bolt editor iframe — its own behavior, not the admin SPA.
  if (/editor\.projectsites\.dev/i.test(url) || /editor\.projectsites\.dev/i.test(text)) return true;
  // Browser-level network logs (cannot be suppressed from JS); the mock server
  // returns no-data 4xx for some empty-state endpoints.
  if (/Failed to load resource: the server responded with a status of [45]\d\d/i.test(text)) return true;
  if (/SharedArrayBuffer|Skipping boot — embedded mode|webcontainer/i.test(text)) return true;
  // Cross-origin script error with no readable detail (always from the iframe).
  if (/^Script error\.?$/i.test(text)) return true;
  return false;
}

interface ConsoleCapture {
  readonly jsErrors: string[];
  readonly badConsole: string[];
}

/** Attach pageerror + console listeners BEFORE the navigation under test. */
function captureConsole(page: Page): ConsoleCapture {
  const jsErrors: string[] = [];
  const badConsole: string[] = [];
  page.on('pageerror', (err) => jsErrors.push(`${err.name}: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    if (!isBenign(msg)) badConsole.push(`${msg.text()} @ ${msg.location()?.url ?? '?'}`);
  });
  return { jsErrors, badConsole };
}

function assertClean(route: string, cap: ConsoleCapture): void {
  expect(cap.jsErrors, `uncaught JS exception(s) on ${route}:\n${cap.jsErrors.join('\n')}`).toEqual([]);
  expect(cap.badConsole, `non-benign console error(s) on ${route}:\n${cap.badConsole.join('\n')}`).toEqual([]);
}

test.describe('admin shell — logo removed + clean console + editor', () => {
  test('sidebar has NO logo; nav renders full-width, flush at the top', async ({ authedPage: page }) => {
    await page.goto('/admin', { waitUntil: 'load' });
    const sidebar = page.locator('.admin-sidebar').first();
    await expect(sidebar).toBeVisible({ timeout: 30000 });

    // No logo imagery anywhere in the sidebar.
    await expect(sidebar.locator('img[src*="logo-text"]')).toHaveCount(0);
    await expect(sidebar.locator('img[src*="logo-header"]')).toHaveCount(0);
    await expect(sidebar.locator('img[alt="ProjectSites"]')).toHaveCount(0);

    // The nav exists with its sections and renders the first (Editor) item.
    const nav = sidebar.locator('nav[aria-label="Admin sections"]');
    await expect(nav).toBeVisible();
    await expect(nav.locator('a.nav-item')).not.toHaveCount(0);
    await expect(nav.getByText('Editor', { exact: true })).toBeVisible();

    // The first interactive child of the sidebar on desktop is the site
    // selector (no logo above it) — proves the nav region sits at the top.
    await expect(sidebar.getByRole('button', { name: 'Select site' })).toBeVisible();
  });

  test('/admin loads with a clean console', async ({ authedPage: page }) => {
    test.setTimeout(60000);
    const cap = captureConsole(page);
    await page.goto('/admin', { waitUntil: 'load' });
    await expect(page.locator('.admin-sidebar').first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(1500); // let lazy data fetches + effects settle
    assertClean('/admin', cap);
  });

  test('admin shell shows NO error toast for background fetches (audit feed + route telemetry)', async ({ authedPage: page }) => {
    // The shell fires two background best-effort calls on every admin nav:
    // /audit/rows (recent-activity feed) and /analytics/track (route telemetry).
    // The mock 404s both — and neither may surface ApiService's generic
    // "resource wasn't found" toast (both pass { silent: true }). Check both new
    // flag routes (site-features is where the telemetry toast was first caught).
    test.setTimeout(60000);
    // route → expected document-title fragment (WCAG 2.4.2 — site-features used
    // to fall back to "Dashboard" because it had no section-label entry).
    const expectTitle: Record<string, RegExp> = {
      '/admin/feature-flags': /Feature Flags/,
      '/admin/site-features': /^Features ·/,
    };
    for (const route of Object.keys(expectTitle)) {
      await page.goto(route, { waitUntil: 'load' });
      await expect(page.locator('.admin-sidebar').first()).toBeVisible({ timeout: 30000 });
      await page.waitForTimeout(1800); // let the background fetches resolve/fail
      const notFoundToast = page.locator('[data-testid="toast-item"]', { hasText: /not found|wasn.t found/i });
      await expect(notFoundToast, `error toast surfaced on ${route}`).toHaveCount(0);
      expect(await page.title(), `wrong document title for ${route}`).toMatch(expectTitle[route]);
    }
  });

  test('site-detail param route: no error toast + no logs/tail retry storm', async ({ authedPage: page }) => {
    // Param sub-routes aren't covered by the top-level gates. site-detail fires
    // 4 secondary reads (site / logs-tail / snapshots / integrations) the mock
    // 404s — all now { silent } so none toast, and the logs-tail poll dropped
    // its inner retry({count:2}) so a 404 no longer triples each 3s tick.
    test.setTimeout(60000);
    const tailReqs: string[] = [];
    page.on('request', (r) => {
      if (/\/api\/sites\/[^/]+\/logs\/tail/.test(r.url())) tailReqs.push(r.url());
    });
    await page.goto('/admin/sites/site-001', { waitUntil: 'load' });
    await expect(page.locator('.admin-sidebar').first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(4000); // timer(0,3000) → ~2 polls in this window
    const notFoundToast = page.locator('[data-testid="toast-item"]', { hasText: /not found|wasn.t found/i });
    await expect(notFoundToast, 'site-detail surfaced an error toast for a 404 secondary read').toHaveCount(0);
    // Pre-fix: 2 polls × (1 + 2 retries) = 6. Post-fix: 2 polls × 1 = ~2.
    expect(tailReqs.length, `logs/tail retry storm: ${tailReqs.length} requests in ~4s`).toBeLessThanOrEqual(3);
  });

  test('editor surface loads (tab strip + persistent bolt iframe)', async ({ authedPage: page }) => {
    test.setTimeout(60000);
    const cap = captureConsole(page);
    await page.goto('/admin/editor', { waitUntil: 'load' });
    await expect(page.locator('.admin-sidebar').first()).toBeVisible({ timeout: 30000 });

    // The editor tab strip only mounts on the editor route.
    await expect(page.locator('[data-testid="editor-tabs-host"]')).toBeVisible({ timeout: 30000 });

    // The persistent bolt.diy iframe is mounted + flagged visible on this route.
    // (We assert the element + visibility class — the cross-origin WebContainer
    // boot is exercised by the prod e2e suite, not the mock-server run.)
    const frame = page.locator('iframe.bolt-frame');
    await expect(frame).toBeAttached({ timeout: 30000 });
    await expect(frame).toHaveClass(/bolt-frame--visible/);

    await page.waitForTimeout(1500);
    assertClean('/admin/editor', cap);
  });

  test('editor pane fills exactly viewport minus the top bar + tab strip', async ({ authedPage: page }) => {
    test.setTimeout(60000);
    await page.goto('/admin/editor', { waitUntil: 'load' });
    await expect(page.locator('[data-testid="editor-tabs-host"]')).toBeVisible({ timeout: 30000 });
    const frame = page.locator('iframe.bolt-frame');
    await expect(frame).toBeAttached({ timeout: 30000 });

    const geo = await page.evaluate(() => {
      const f = document.querySelector('iframe.bolt-frame') as HTMLElement | null;
      const tb = document.querySelector('.admin-topbar') as HTMLElement | null;
      const ts = document.querySelector('.editor-tabs-host') as HTMLElement | null;
      const r = f?.getBoundingClientRect();
      return {
        innerHeight: window.innerHeight,
        topbarH: tb?.getBoundingClientRect().height ?? 0,
        tabsH: ts?.getBoundingClientRect().height ?? 0,
        frameTop: r?.top ?? 0,
        frameHeight: r?.height ?? 0,
        frameBottom: r?.bottom ?? 0,
      };
    });

    // Editor starts right below the two stacked bars…
    expect(Math.abs(geo.frameTop - (geo.topbarH + geo.tabsH))).toBeLessThanOrEqual(3);
    // …its height === viewport - topbar - tab strip…
    expect(Math.abs(geo.frameHeight - (geo.innerHeight - geo.topbarH - geo.tabsH))).toBeLessThanOrEqual(3);
    // …and its bottom lands flush at the viewport bottom (no overflow / scroll).
    expect(Math.abs(geo.frameBottom - geo.innerHeight)).toBeLessThanOrEqual(3);
  });
});

test.describe('project-wide console sweep — each major route loads clean', () => {
  const ADMIN_ROUTES = ['/admin', '/admin/analytics', '/admin/forms', '/admin/settings', '/admin/feature-flags'];
  for (const route of ADMIN_ROUTES) {
    test(`authed ${route} loads with a clean console`, async ({ authedPage: page }) => {
      test.setTimeout(60000);
      const cap = captureConsole(page);
      await page.goto(route, { waitUntil: 'load' });
      await expect(page.locator('.admin-sidebar').first()).toBeVisible({ timeout: 30000 });
      await page.waitForTimeout(1200);
      assertClean(route, cap);
    });
  }

  const PUBLIC_ROUTES = ['/', '/signin', '/search'];
  for (const route of PUBLIC_ROUTES) {
    test(`anon ${route} loads with a clean console`, async ({ anonPage: page }) => {
      test.setTimeout(60000);
      const cap = captureConsole(page);
      await page.goto(route, { waitUntil: 'load' });
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(1200);
      assertClean(route, cap);
    });
  }
});
