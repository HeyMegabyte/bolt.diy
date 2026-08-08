/**
 * Admin — Site Features Journey (STRICT — zero soft-guards)
 *
 * Covers /admin/site-features — the owner-facing feature toggle grid (Layer 2
 * of the two-layer feature-flag control plane).
 *
 * The /api/site-features catalog is STUBBED with a deterministic 4-feature
 * payload (plan 'pro', matching the component's
 * `{ features: SiteFeature[]; plan: PlanTier }` response shape), so BOTH
 * template branches — entitled toggle vs plan-gate locked block — render
 * deterministically and are hard-asserted. Every `if (isVisible)` guard from
 * the previous revision is gone.
 *
 * Contract:
 * - signInAsTestUser(page) FIRST; section stubs register AFTER it so they win
 *   reverse-match order over the auth helper's benign `**` catch-all (which
 *   previously forced the component into degraded fallback mode — the root
 *   cause of the old soft-guards).
 * - ALL mutations intercepted; the per-key toggle POST is captured and its
 *   body asserted.
 * - Glob law: mid-token `**` cannot cross '/', so the per-key subpath gets an
 *   explicit `/**` twin alongside the query-suffix list glob.
 * - /api/feature-flags stays pass-through (public, anonymous-safe) via the
 *   auth helper's continue() routes — GETs here fall back, never fulfill.
 */
import { test, expect, type Page } from '@playwright/test';
import { signInAsTestUser } from './helpers/auth.js';
import { checkA11y } from './helpers/a11y.js';

const PROD_URL = process.env.PROD_URL ?? 'https://projectsites.dev';

test.use({ serviceWorkers: 'block' });

interface CapturedPost {
  url: string;
  body: Record<string, unknown> | null;
}

/**
 * Deterministic owner-features catalog. Shape mirrors the worker's
 * GET /api/site-features response the component parses in `reload()`:
 * `{ features: SiteFeature[]; plan: PlanTier }`. One feature per entitlement
 * branch so every template path is exercised:
 * - donations_engine      available + enabled  → switch ON
 * - email_marketing       available + off      → switch OFF (toggle target)
 * - storefront_ecommerce  upgrade-required     → locked block, "Upgrade plan"
 * - page_audio            addon-required       → locked block, "Add this feature"
 */
const SITE_FEATURES_PAYLOAD = {
  plan: 'pro',
  features: [
    {
      key: 'donations_engine',
      name: 'Donations',
      description: 'Accept secure one-time and recurring gifts on your site.',
      requiredPlan: 'free',
      isAddon: false,
      category: 'Sell',
      entitled: 'available',
      enabled: true,
      preview: false,
    },
    {
      key: 'email_marketing',
      name: 'Newsletter',
      description: 'Collect subscribers and send branded campaigns from your own domain.',
      requiredPlan: 'pro',
      isAddon: false,
      category: 'Grow',
      entitled: 'available',
      enabled: false,
      preview: false,
    },
    {
      key: 'storefront_ecommerce',
      name: 'Online Store',
      description: 'Sell products with catalog, cart, and secure checkout.',
      requiredPlan: 'business',
      isAddon: false,
      category: 'Sell',
      entitled: 'upgrade-required',
      enabled: false,
      preview: false,
    },
    {
      key: 'page_audio',
      name: 'Page Audio',
      description: 'Auto-generate a narrated audio version of each page.',
      requiredPlan: 'pro',
      isAddon: true,
      category: 'Engage',
      entitled: 'addon-required',
      enabled: false,
      preview: false,
    },
  ],
};

/**
 * Registers the section's deterministic stubs. MUST run AFTER
 * signInAsTestUser(page) — Playwright matches routes in reverse registration
 * order, so these override the auth helper's benign catch-all.
 * Returns the array that accumulates captured site-features mutations.
 */
async function installSiteFeaturesStubs(page: Page): Promise<CapturedPost[]> {
  const posts: CapturedPost[] = [];

  // Deterministic sites LIST → AdminStateService.selectedSite() === sites[0]
  // === e2e-site-001, so the toggle POST body carries a stable site_id and
  // the header renders "E2E Test Site".
  // glob-ok: query-suffix only — /api/sites/:id/* falls through (mid-token **
  // cannot cross '/').
  await page.route('**/api/sites**', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: [
          {
            id: 'e2e-site-001',
            slug: 'e2e-test-site',
            name: 'E2E Test Site',
            business_name: 'E2E Test Site',
            status: 'published',
            org_id: 'e2e-test-org',
            primary_hostname: 'e2e-test-site.projectsites.dev',
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-07-01T00:00:00Z',
          },
        ],
        meta: { total: 1 },
      }),
    });
  });

  // ALL mutations intercepted with a benign 200; GETs fall through to the
  // more-specific handlers below or to the auth helper's routes (which keep
  // /api/feature-flags + /api/feature-flags/** as prod pass-through).
  // glob-ok: deliberate catch-all, mutation-only fulfill.
  await page.route('**/api/**', (route) => {
    const m = route.request().method();
    if (m === 'POST' || m === 'PATCH' || m === 'PUT' || m === 'DELETE') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }
    return route.fallback();
  });

  // Owner catalog — GET /api/site-features and /api/site-features?site_id=…
  // Registered after the catch-alls so it wins reverse-match order.
  // glob-ok: query-suffix only — per-key subpath handled by the /** twin below.
  await page.route('**/api/site-features**', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(SITE_FEATURES_PAYLOAD),
    });
  });

  // Per-key mutation twin — POST /api/site-features/:key. Captures each body
  // so the spec asserts the exact payload the component sends.
  await page.route('**/api/site-features/**', (route) => {
    const req = route.request();
    if (req.method() !== 'POST') return route.fallback();
    posts.push({
      url: req.url(),
      body: req.postDataJSON() as Record<string, unknown> | null,
    });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
  });

  return posts;
}

/** Attach a console-error collector BEFORE navigation. */
function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return errors;
}

/** Filter out third-party/network noise that isn't an app defect. */
function realErrors(errors: string[]): string[] {
  return errors.filter(
    (e) =>
      !e.includes('favicon') &&
      !e.includes('third-party') &&
      !e.includes('ERR_BLOCKED_BY_CLIENT') &&
      !e.toLowerCase().includes('failed to load resource'),
  );
}

/** Navigate to the section and wait for its root to render. */
async function openSiteFeatures(page: Page): Promise<void> {
  await page.goto(`${PROD_URL}/admin/site-features`, {
    waitUntil: 'domcontentloaded',
    timeout: 25_000,
  });
  expect(page.url()).not.toContain('/signin');
  await expect(page.locator('app-admin, [data-cockpit="v2"]')).toBeVisible({ timeout: 35_000 });
  // Scroll-nudge triggers appReveal (opacity: 0 on mount).
  await page.mouse.wheel(0, 200);
  await expect(page.locator('[data-testid="sf-root"]')).toBeVisible({ timeout: 15_000 });
}

test.describe('Admin — Site Features (authenticated journey)', () => {
  test('feature grid renders the stubbed catalog deterministically', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await signInAsTestUser(page);
    await installSiteFeaturesStubs(page);
    await openSiteFeatures(page);

    await expect(page.locator('[data-testid="sf-layer-heading"]')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-testid="sf-search"]')).toBeVisible();
    await expect(page.locator('[data-testid="sf-nav-system"]')).toBeVisible();

    // Exactly the 4 stubbed cards — no soft "greater than 0".
    const cards = page.locator('[data-testid^="sf-card-"]');
    await expect(cards).toHaveCount(4, { timeout: 15_000 });
    await expect(page.locator('[data-testid="sf-card-donations_engine"]')).toBeVisible();
    await expect(page.locator('[data-testid="sf-card-email_marketing"]')).toBeVisible();
    await expect(page.locator('[data-testid="sf-card-storefront_ecommerce"]')).toBeVisible();
    await expect(page.locator('[data-testid="sf-card-page_audio"]')).toBeVisible();

    // Header reflects the stubbed site + plan.
    await expect(page.locator('[data-testid="sf-root"]')).toContainText('E2E Test Site');
    await expect(page.locator('[data-testid="sf-root"]')).toContainText('pro plan');

    // Live catalog (NOT the degraded read-only fallback): banner absent.
    await expect(page.locator('[data-testid="sf-provisioning"]')).toBeHidden();

    // "What's included" checklist renders for catalog-known features.
    await expect(
      page.locator('[data-testid="sf-card-donations_engine"] [data-testid="sf-checklist"]'),
    ).toBeVisible();

    // sf-filter-count renders only while a search query is active.
    await expect(page.locator('[data-testid="sf-filter-count"]')).toBeHidden();

    await page.screenshot({ path: 'e2e/screenshots/site-features/grid.png', fullPage: true });
    await checkA11y(page, 'site-features-grid');

    expect(realErrors(errors)).toEqual([]);
  });

  test('search narrows the grid, empty state appears, clear-search restores', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await signInAsTestUser(page);
    await installSiteFeaturesStubs(page);
    await openSiteFeatures(page);

    const cards = page.locator('[data-testid^="sf-card-"]');
    await expect(cards).toHaveCount(4, { timeout: 15_000 });

    const search = page.locator('[data-testid="sf-search"]');
    await expect(search).toBeVisible();
    await search.click();
    await page.keyboard.type('newsletter');

    // Narrows to exactly the one matching card + a visible "1 of 4" chip.
    await expect(cards).toHaveCount(1);
    await expect(page.locator('[data-testid="sf-card-email_marketing"]')).toBeVisible();
    const chip = page.locator('[data-testid="sf-filter-count"]');
    await expect(chip).toBeVisible();
    await expect(chip).toHaveText(/1\s*of\s*4/);

    // No-match query → "0 of 4" chip + the search-miss empty state replaces
    // the grid entirely.
    await search.click({ clickCount: 3 });
    await page.keyboard.type('zzz-no-match');
    await expect(chip).toHaveText(/0\s*of\s*4/);
    await expect(cards).toHaveCount(0);
    const empty = page.locator('[data-testid="sf-empty"]');
    await expect(empty).toBeVisible();

    await page.screenshot({ path: 'e2e/screenshots/site-features/search-filter.png' });

    // Empty-state CTA clears the query and restores the full grid
    // (deterministic wait, no sleeps).
    await empty.getByRole('button', { name: 'Clear search' }).click();
    await expect(cards).toHaveCount(4);
    await expect(chip).toBeHidden();
    await expect(empty).toBeHidden();

    expect(realErrors(errors)).toEqual([]);
  });

  test('entitlement branches are exhaustive — toggle for available, plan-gate for locked', async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);
    await signInAsTestUser(page);
    await installSiteFeaturesStubs(page);
    await openSiteFeatures(page);

    // Available + enabled → interactive switch, ON.
    const donationsToggle = page.locator(
      '[data-testid="sf-card-donations_engine"] [data-testid="sf-toggle"]',
    );
    await expect(donationsToggle).toBeVisible({ timeout: 15_000 });
    await expect(donationsToggle).toHaveAttribute('role', 'switch');
    await expect(donationsToggle).toHaveAttribute('aria-checked', 'true');
    await expect(donationsToggle).toBeEnabled();

    // Available + off → interactive switch, OFF (proves NOT degraded).
    const newsletterToggle = page.locator(
      '[data-testid="sf-card-email_marketing"] [data-testid="sf-toggle"]',
    );
    await expect(newsletterToggle).toHaveAttribute('role', 'switch');
    await expect(newsletterToggle).toHaveAttribute('aria-checked', 'false');
    await expect(newsletterToggle).toBeEnabled();

    // Plan-gated → locked block + upgrade CTA, and NO toggle at all.
    const upgradeCard = page.locator('[data-testid="sf-card-storefront_ecommerce"]');
    await expect(upgradeCard).toHaveAttribute('data-entitled', 'upgrade-required');
    await expect(upgradeCard.locator('[data-testid="sf-locked"]')).toBeVisible();
    const upgradeCta = upgradeCard.locator('[data-testid="sf-locked-cta"]');
    await expect(upgradeCta).toContainText('Upgrade plan');
    await expect(upgradeCta).toHaveAttribute('href', '/admin/billing');
    await expect(upgradeCard.locator('[data-testid="sf-toggle"]')).toHaveCount(0);

    // Add-on-gated → locked block with the add-on CTA copy, no toggle.
    const addonCard = page.locator('[data-testid="sf-card-page_audio"]');
    await expect(addonCard).toHaveAttribute('data-entitled', 'addon-required');
    await expect(addonCard.locator('[data-testid="sf-locked"]')).toBeVisible();
    await expect(addonCard.locator('[data-testid="sf-locked-cta"]')).toContainText(
      'Add this feature',
    );
    await expect(addonCard.locator('[data-testid="sf-toggle"]')).toHaveCount(0);

    await page.screenshot({
      path: 'e2e/screenshots/site-features/entitlements.png',
      fullPage: true,
    });

    expect(realErrors(errors)).toEqual([]);
  });

  test('toggle POSTs the mutation, undo reverts it, preview panel opens', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await signInAsTestUser(page);
    const posts = await installSiteFeaturesStubs(page);
    await openSiteFeatures(page);

    const toggle = page.locator(
      '[data-testid="sf-card-email_marketing"] [data-testid="sf-toggle"]',
    );
    await expect(toggle).toBeVisible({ timeout: 15_000 });
    await expect(toggle).toHaveAttribute('aria-checked', 'false');

    // Enable — optimistic flip + captured POST + undo bar.
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    const undoBar = page.locator('[data-testid="sf-undo"]');
    await expect(undoBar).toBeVisible();
    await expect(undoBar).toContainText('Newsletter enabled.');
    // The undo bar only renders after the POST resolves → capture is complete.
    expect(posts).toHaveLength(1);
    expect(posts[0].url).toContain('/api/site-features/email_marketing');
    expect(posts[0].body).toMatchObject({ site_id: 'e2e-site-001', enabled: true });

    await page.screenshot({ path: 'e2e/screenshots/site-features/toggle-undo.png' });

    // Undo — reverts the switch via a second captured mutation.
    await page.locator('[data-testid="sf-undo-btn"]').click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await expect(undoBar).toContainText('Newsletter disabled.');
    expect(posts).toHaveLength(2);
    expect(posts[1].body).toMatchObject({ site_id: 'e2e-site-001', enabled: false });

    // Preview panel toggles open/closed (pure client state, no network).
    const previewBtn = page.locator(
      '[data-testid="sf-card-email_marketing"] [data-testid="sf-preview"]',
    );
    const previewPanel = page.locator('[data-testid="sf-preview-panel"]');
    await expect(previewPanel).toBeHidden();
    await previewBtn.click();
    await expect(previewPanel).toBeVisible();
    await expect(previewBtn).toHaveAttribute('aria-pressed', 'true');
    await previewBtn.click();
    await expect(previewPanel).toBeHidden();

    expect(realErrors(errors)).toEqual([]);
  });

  test('mobile 375px — grid is responsive, zero console errors', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await page.setViewportSize({ width: 375, height: 812 });

    await signInAsTestUser(page);
    await installSiteFeaturesStubs(page);
    await openSiteFeatures(page);

    // Full stubbed grid renders at mobile width.
    await expect(page.locator('[data-testid="sf-layer-heading"]')).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator('[data-testid^="sf-card-"]')).toHaveCount(4, { timeout: 15_000 });

    // No horizontal overflow on 375px.
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(385);

    await page.screenshot({
      path: 'e2e/screenshots/site-features/mobile-375.png',
      fullPage: true,
    });

    expect(realErrors(errors)).toEqual([]);
  });

  test('unauthenticated access redirects to sign-in', async ({ page }) => {
    await page.goto(`${PROD_URL}/admin/site-features`);
    await page.waitForURL('**/signin**', { timeout: 10_000 });
    await expect(
      page.locator('[data-testid="sign-in-page"], [data-testid="auth-container"], form').first(),
    ).toBeVisible();
  });
});
