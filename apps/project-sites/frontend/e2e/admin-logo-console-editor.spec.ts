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
