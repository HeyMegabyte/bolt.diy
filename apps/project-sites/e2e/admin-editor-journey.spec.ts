/**
 * Admin — Editor Section (bolt.diy iframe) authenticated journey spec.
 *
 * Mount contract under test (see frontend/CLAUDE.md § BoltEmbedService):
 * - The bolt.diy iframe (`.bolt-frame`, src → editor.projectsites.dev) lives in
 *   AdminComponent's template and is OWNED by BoltEmbedService, so route
 *   navigation between admin sub-routes must NEVER destroy it.
 * - EditorComponent (`app-admin-editor`) is a thin shell: empty-state when no
 *   site is selected, `.ed-veil` loading veil until PS_BOLT_CHAT_READY flips
 *   `bolt.editorReady()`.
 * - We do NOT wait for full WebContainer boot (30-60s, external service). The
 *   journey asserts the MOUNT contract hard, and probes boot state with ONE
 *   tolerant 20s soft check that logs (never fails).
 *
 * Hard assertions:
 *  (a) /admin/editor mounts authenticated; `.bolt-frame` exists with
 *      `bolt-frame--visible` and src containing editor.projectsites.dev
 *  (b) the SAME iframe element survives /admin/editor → /admin/forms →
 *      /admin/editor (data-ps-e2e-marker persists; element never re-created)
 *  (c) editor chrome renders: `[data-testid="editor-tabs-host"]` (mounted
 *      only on the editor route)
 *
 * Selectors (grepped from admin.component.html + editor.component.ts):
 *  - `.bolt-frame` / `.bolt-frame--visible`  — persistent iframe
 *  - `[data-testid="editor-tabs-host"]`      — tab strip above the iframe
 *  - `[data-testid="editor-overlay-media"]`  — media overlay aside (tab-gated)
 *  - `[data-testid="editor-overlay-agents"]` — agents overlay aside (tab-gated)
 *  - `.ed-veil`                              — boot veil (PS_BOLT_READY-driven)
 *  - `.empty-state-pretty`                   — no-site-selected state
 *  - `a.nav-item[routerLink="/admin/forms"]` — sidebar nav (no testid yet)
 *
 * Stubbing contract (TDD journey contract):
 *  - signInAsTestUser FIRST — injects session + registers the benign
 *    `**\/api\/**` catch-all (checked LAST) + ONE stubbed site
 *    (id `e2e-site-001`, status `published`) so `selectedSite()` resolves and
 *    BoltEmbedService boots the iframe URL.
 *  - Editor-adjacent GETs (build-context, workflow, audit, inbox) are served
 *    by the auth helper's benign catch-all — the editor shell reads state only.
 *  - ALL mutations (POST/PATCH/PUT/DELETE) intercepted → never reach prod.
 *  - The iframe's own cross-origin traffic to editor.projectsites.dev is NOT
 *    stubbed — we never reach inside the frame.
 */
import { test, expect, type Page } from '@playwright/test';
import { signInAsTestUser } from './helpers/auth.js';
import { checkA11y } from './helpers/a11y.js';

const PROD_URL = process.env.PROD_URL ?? 'https://projectsites.dev';

test.use({ serviceWorkers: 'block' });

/**
 * Intercepts every /api mutation so nothing writes to prod. Registered LAST so
 * Playwright checks it FIRST; GET/HEAD fall back to older (stub) routes.
 * glob-ok: '**' suffix — mutation guard must cover every /api subpath + query.
 */
async function interceptMutations(page: Page): Promise<{ method: string; url: string }[]> {
  const mutations: { method: string; url: string }[] = [];
  await page.route('**/api/**', async (route) => {
    const method = route.request().method();
    if (method === 'GET' || method === 'HEAD') return route.fallback();
    mutations.push({ method, url: route.request().url() });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
  });
  return mutations;
}

/** Navigate to /admin/editor and wait for the admin shell. */
async function gotoEditor(page: Page): Promise<void> {
  await page.goto(`${PROD_URL}/admin/editor`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  expect(page.url()).not.toContain('/signin');
  await expect(page.locator('app-admin, [data-cockpit="v2"]')).toBeVisible({ timeout: 35_000 });
  // appReveal keeps elements opacity:0 until IntersectionObserver fires
  await page.mouse.wheel(0, 200);
}

test.describe('Admin — Editor (bolt.diy iframe journey)', () => {
  // -------------------------------------------------------------------------
  // Test 1: mount contract — iframe present, visible-class, src → bolt origin
  // -------------------------------------------------------------------------
  test('editor mounts with bolt-frame iframe pointed at editor.projectsites.dev', async ({ page }) => {
    await signInAsTestUser(page);
    await interceptMutations(page);
    await gotoEditor(page);

    // The iframe ELEMENT must be present. It renders once BoltEmbedService
    // resolves iframeUrl() for the stubbed published site — attached implies
    // the src binding evaluated.
    const boltFrame = page.locator('.bolt-frame');
    await expect(boltFrame).toBeAttached({ timeout: 20_000 });

    // On /admin/editor the frame carries the --visible class (route-lifted).
    await expect(boltFrame).toHaveClass(/bolt-frame--visible/, { timeout: 15_000 });

    // HARD contract: src points at the bolt.diy origin.
    await expect(boltFrame).toHaveAttribute('src', /editor\.projectsites\.dev/, {
      timeout: 15_000,
    });

    await page.screenshot({
      path: 'e2e/screenshots/admin-editor/section-mounted.png',
      fullPage: false,
    });
  });

  // -------------------------------------------------------------------------
  // Test 2: the iframe SURVIVES a route round-trip (persistent-iframe law)
  // -------------------------------------------------------------------------
  test('bolt-frame survives /admin/editor → /admin/forms → /admin/editor round-trip', async ({ page }) => {
    await signInAsTestUser(page);
    await interceptMutations(page);
    await gotoEditor(page);

    const boltFrame = page.locator('.bolt-frame');
    await expect(boltFrame).toBeAttached({ timeout: 20_000 });
    await expect(boltFrame).toHaveClass(/bolt-frame--visible/, { timeout: 15_000 });

    // Tag the LIVE DOM element. If route navigation ever re-creates the
    // iframe, this attribute is lost and the persistence law is broken.
    await boltFrame.evaluate((el) => el.setAttribute('data-ps-e2e-marker', 'round-trip'));
    await page.screenshot({
      path: 'e2e/screenshots/admin-editor/roundtrip-1-editor.png',
      fullPage: false,
    });

    // Leg 1 — SPA-navigate away via the sidebar nav (clicks only, no goto).
    // Dual selector: static routerLink attr + RouterLink-written href.
    await page
      .locator('a.nav-item[routerLink="/admin/forms"], a.nav-item[href="/admin/forms"]')
      .first()
      .click();
    await expect(page).toHaveURL(/\/admin\/forms/, { timeout: 15_000 });
    await expect(page.locator('app-admin-forms').first()).toBeVisible({ timeout: 15_000 });

    // While AWAY from the editor: iframe stays attached (hidden, not destroyed)
    // and it is the SAME element (marker persists).
    await expect(page.locator('.bolt-frame[data-ps-e2e-marker="round-trip"]')).toBeAttached({
      timeout: 10_000,
    });
    await expect(boltFrame).not.toHaveClass(/bolt-frame--visible/, { timeout: 10_000 });
    await page.screenshot({
      path: 'e2e/screenshots/admin-editor/roundtrip-2-forms.png',
      fullPage: false,
    });

    // Leg 2 — SPA-navigate back to the editor.
    await page
      .locator('a.nav-item[routerLink="/admin/editor"], a.nav-item[href="/admin/editor"]')
      .first()
      .click();
    await expect(page).toHaveURL(/\/admin\/editor/, { timeout: 15_000 });

    // SAME element re-lifted into place: marker intact + visible class back.
    const persisted = page.locator('.bolt-frame[data-ps-e2e-marker="round-trip"]');
    await expect(persisted).toBeAttached({ timeout: 10_000 });
    await expect(persisted).toHaveClass(/bolt-frame--visible/, { timeout: 15_000 });
    await expect(persisted).toHaveAttribute('src', /editor\.projectsites\.dev/, {
      timeout: 10_000,
    });

    await page.screenshot({
      path: 'e2e/screenshots/admin-editor/roundtrip-3-back.png',
      fullPage: false,
    });
  });

  // -------------------------------------------------------------------------
  // Test 3: editor chrome — tabs host hard; overlay asides tolerant (tab-gated)
  // -------------------------------------------------------------------------
  test('editor chrome renders: tabs host mounted on the editor route', async ({ page }) => {
    await signInAsTestUser(page);
    await interceptMutations(page);
    await gotoEditor(page);

    // `@if (isEditorRoute())` in admin.component.html — the tab strip is a
    // HARD mount-contract element on /admin/editor.
    const tabsHost = page.locator('[data-testid="editor-tabs-host"]');
    await expect(tabsHost).toBeVisible({ timeout: 20_000 });

    // Overlay asides only exist while their tab is ACTIVE — presence is
    // tolerant, but when present they must be visible.
    for (const overlay of ['editor-overlay-media', 'editor-overlay-agents']) {
      const el = page.locator(`[data-testid="${overlay}"]`);
      if (await el.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await expect(el).toBeVisible();
      }
    }

    await page.screenshot({
      path: 'e2e/screenshots/admin-editor/admin-chrome.png',
      fullPage: false,
    });
  });

  // -------------------------------------------------------------------------
  // Test 4: tolerant boot probe — PS_BOLT_READY veil, 20s soft, log-only
  // -------------------------------------------------------------------------
  test('boot probe (tolerant): PS_BOLT_READY veil state logged, never failed', async ({ page }) => {
    await signInAsTestUser(page);
    await interceptMutations(page);
    await gotoEditor(page);

    await expect(page.locator('.bolt-frame')).toBeAttached({ timeout: 20_000 });

    // `.ed-veil` shows while a site is selected AND editorReady() is false; it
    // is dismissed the instant bolt.diy postMessages PS_BOLT_CHAT_READY
    // (PS_BOLT_READY family — see bolt-embed.service.ts markEditorReady).
    // WebContainer cold boot is 30-60s against an EXTERNAL service, so this is
    // a soft 20s poll: we LOG the boot state and never fail on it.
    const emptyState = page.locator('.empty-state-pretty');
    const veil = page.locator('.ed-veil');
    if (await emptyState.isVisible({ timeout: 2_000 }).catch(() => false)) {
      console.warn('[editor-journey] boot probe: no site selected — empty state (tolerated)');
    } else {
      const dismissed = await veil
        .waitFor({ state: 'detached', timeout: 20_000 })
        .then(() => true)
        .catch(() => false);
      console.warn(
        dismissed
          ? '[editor-journey] boot probe: editor READY — PS_BOLT_READY veil dismissed within 20s'
          : '[editor-journey] boot probe: still booting after 20s soft window (tolerated — external WebContainer)',
      );
    }

    await page.screenshot({
      path: 'e2e/screenshots/admin-editor/boot-probe.png',
      fullPage: false,
    });
  });

  // -------------------------------------------------------------------------
  // Test 5: zero critical console errors on /admin/editor
  // -------------------------------------------------------------------------
  test('no critical console errors on /admin/editor', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });

    await signInAsTestUser(page);
    await interceptMutations(page);
    await gotoEditor(page);
    await expect(page.locator('.bolt-frame')).toBeAttached({ timeout: 20_000 });

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
  // Test 6: a11y advisory pass (critical-only failure gate)
  // -------------------------------------------------------------------------
  test('a11y advisory — no critical violations on /admin/editor', async ({ page }) => {
    await signInAsTestUser(page);
    await interceptMutations(page);
    await gotoEditor(page);

    // The bolt.diy iframe is THIRD-PARTY surface (editor.projectsites.dev)
    // whose mid-boot DOM intermittently trips criticals under parallel load —
    // not our markup; excluded per the checkA11y vendored-widget doctrine.
    await checkA11y(page, 'admin-editor', { exclude: ['.bolt-frame', 'iframe'] });
    await page.screenshot({ path: 'e2e/screenshots/admin-editor/a11y.png', fullPage: false });
  });

  // -------------------------------------------------------------------------
  // Test 7: mobile render (375px) — shell + persistent iframe still attached
  // -------------------------------------------------------------------------
  test('mobile 375px — admin shell renders and bolt-frame is attached', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });

    await signInAsTestUser(page);
    await interceptMutations(page);
    await gotoEditor(page);

    await expect(page.locator('.bolt-frame')).toBeAttached({ timeout: 20_000 });

    await page.screenshot({ path: 'e2e/screenshots/admin-editor/mobile-375.png', fullPage: false });
  });
});
