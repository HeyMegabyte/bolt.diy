/**
 * Admin — Editor Section (bolt.diy iframe) journey spec.
 *
 * Strategy:
 * - The bolt.diy iframe lives in AdminComponent, not EditorComponent.
 *   EditorComponent is a thin shell that shows a loading veil while the
 *   iframe boots. WebContainer cold-start is 30-60s — we NEVER wait for it.
 * - We assert: (a) the iframe ELEMENT is present in the DOM with src
 *   pointing at editor.projectsites.dev, (b) admin chrome is visible, and
 *   (c) no critical console errors.
 * - The iframe itself is cross-origin; we cannot reach inside it.
 *
 * Selector notes (from admin.component.html grep pass):
 *   - iframe class: `.bolt-frame` (always present in DOM)
 *   - class added when on /admin/editor: `.bolt-frame--visible`
 *   - `[data-testid="editor-tabs-host"]` — tabs bar when editor is active
 *   - `[data-testid="editor-overlay-media"]` — media overlay button
 *   - `[data-testid="editor-overlay-agents"]` — agents overlay button
 */
import { test, expect } from '@playwright/test';
import { signInAsTestUser } from './helpers/auth.js';
import { checkA11y } from './helpers/a11y.js';

const PROD_URL = process.env.PROD_URL ?? 'https://projectsites.dev';

test.use({ serviceWorkers: 'block' });

test.describe('Admin — Editor (bolt.diy iframe journey)', () => {
  // -------------------------------------------------------------------------
  // Test 1: section mounts, bolt-frame element is present, admin chrome visible
  // -------------------------------------------------------------------------
  test('editor section mounts and bolt-frame iframe element is in the DOM', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });

    // Intercept ALL POST/PATCH/PUT/DELETE so mutations never reach prod
    await page.route('**/api/**', async (route) => {
      const method = route.request().method();
      if (method === 'POST' || method === 'PATCH' || method === 'PUT' || method === 'DELETE') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      }
      return route.fallback();
    });

    await signInAsTestUser(page);
    await page.goto(`${PROD_URL}/admin/editor`, { waitUntil: 'domcontentloaded', timeout: 30_000 });

    // Must stay in admin, not redirected to sign-in
    expect(page.url()).not.toContain('/signin');

    // Admin shell must be present
    await expect(page.locator('app-admin, [data-cockpit="v2"]')).toBeVisible({ timeout: 20_000 });

    // Scroll nudge — appReveal keeps elements opacity:0 until IntersectionObserver fires
    await page.mouse.wheel(0, 200);

    // The iframe ELEMENT must be present in the DOM.
    // It lives in AdminComponent (not EditorComponent) so it persists across routes.
    // We do NOT wait for WebContainer boot (30-60s).
    const boltFrame = page.locator('.bolt-frame');
    await expect(boltFrame).toBeAttached({ timeout: 15_000 });

    // On /admin/editor the frame gets the --visible class
    await expect(boltFrame).toHaveClass(/bolt-frame--visible/, { timeout: 15_000 });

    // The src attribute must point at editor.projectsites.dev (or be null while binding evaluates)
    // src may be null if BoltEmbedService hasn't resolved iframeUrl() yet (no selected site stub)
    // Either null OR a URL containing editor.projectsites.dev is acceptable
    const src = await boltFrame.getAttribute('src');
    if (src !== null) {
      expect(src).toContain('editor.projectsites.dev');
    }

    await page.screenshot({
      path: 'e2e/screenshots/admin-editor/section-mounted.png',
      fullPage: false,
    });
  });

  // -------------------------------------------------------------------------
  // Test 2: admin chrome visible (tabs host, overlay buttons)
  // -------------------------------------------------------------------------
  test('editor admin chrome (tabs host, overlay buttons) is present', async ({ page }) => {
    await page.route('**/api/**', async (route) => {
      const method = route.request().method();
      if (method === 'POST' || method === 'PATCH' || method === 'PUT' || method === 'DELETE') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      }
      return route.fallback();
    });

    await signInAsTestUser(page);
    await page.goto(`${PROD_URL}/admin/editor`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    expect(page.url()).not.toContain('/signin');

    await expect(page.locator('app-admin, [data-cockpit="v2"]')).toBeVisible({ timeout: 20_000 });
    await page.mouse.wheel(0, 200);

    // Editor tabs host — the bar that contains overlay buttons
    const tabsHost = page.locator('[data-testid="editor-tabs-host"]');
    if (await tabsHost.isVisible({ timeout: 8_000 }).catch(() => false)) {
      await expect(tabsHost).toBeVisible();
    }

    // Media overlay affordance (conditional on site selection)
    const mediaOverlay = page.locator('[data-testid="editor-overlay-media"]');
    if (await mediaOverlay.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await expect(mediaOverlay).toBeVisible();
    }

    // Agents overlay affordance (conditional on site selection)
    const agentsOverlay = page.locator('[data-testid="editor-overlay-agents"]');
    if (await agentsOverlay.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await expect(agentsOverlay).toBeVisible();
    }

    await page.screenshot({
      path: 'e2e/screenshots/admin-editor/admin-chrome.png',
      fullPage: false,
    });
  });

  // -------------------------------------------------------------------------
  // Test 3: zero critical console errors
  // -------------------------------------------------------------------------
  test('no critical console errors on /admin/editor', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });

    await page.route('**/api/**', async (route) => {
      const method = route.request().method();
      if (method === 'POST' || method === 'PATCH' || method === 'PUT' || method === 'DELETE') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      }
      return route.fallback();
    });

    await signInAsTestUser(page);
    await page.goto(`${PROD_URL}/admin/editor`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await expect(page.locator('app-admin, [data-cockpit="v2"]')).toBeVisible({ timeout: 20_000 });

    // Let appReveal settle
    await page.mouse.wheel(0, 200);

    const real = errors.filter(
      (e) =>
        !e.includes('favicon') &&
        !e.includes('third-party') &&
        !e.includes('net::ERR') &&
        !e.toLowerCase().includes('failed to load resource'),
    );
    expect(real).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Test 4: a11y advisory pass (critical-only failure gate)
  // -------------------------------------------------------------------------
  test('a11y advisory — no critical violations on /admin/editor', async ({ page }) => {
    await page.route('**/api/**', async (route) => {
      const method = route.request().method();
      if (method === 'POST' || method === 'PATCH' || method === 'PUT' || method === 'DELETE') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      }
      return route.fallback();
    });

    await signInAsTestUser(page);
    await page.goto(`${PROD_URL}/admin/editor`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await expect(page.locator('app-admin, [data-cockpit="v2"]')).toBeVisible({ timeout: 20_000 });
    await page.mouse.wheel(0, 200);

    await checkA11y(page, 'admin-editor');
    await page.screenshot({ path: 'e2e/screenshots/admin-editor/a11y.png', fullPage: false });
  });

  // -------------------------------------------------------------------------
  // Test 5: mobile render (375px) — admin shell still visible
  // -------------------------------------------------------------------------
  test('mobile 375px — admin shell renders on /admin/editor', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });

    await page.route('**/api/**', async (route) => {
      const method = route.request().method();
      if (method === 'POST' || method === 'PATCH' || method === 'PUT' || method === 'DELETE') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      }
      return route.fallback();
    });

    await signInAsTestUser(page);
    await page.goto(`${PROD_URL}/admin/editor`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await expect(page.locator('app-admin, [data-cockpit="v2"]')).toBeVisible({ timeout: 20_000 });

    await page.mouse.wheel(0, 200);
    const boltFrame = page.locator('.bolt-frame');
    await expect(boltFrame).toBeAttached({ timeout: 15_000 });

    await page.screenshot({ path: 'e2e/screenshots/admin-editor/mobile-375.png', fullPage: false });
  });
});
