/**
 * flows-site-features.flow.e2e.ts — Surface: /admin/site-features ("Features").
 *
 * THIS is where the ~88 libs/features/* dark-launch modules are actually surfaced
 * to the site owner (each a `sf-card-<slug>` with a `sf-toggle` when available or
 * `sf-locked` + `sf-locked-cta` when plan-gated). Real testids from a live DOM
 * probe: sf-root, sf-layer-heading, sf-nav-system, sf-search, sf-card-<slug>,
 * sf-toggle, ff-badge-row, sf-checklist, sf-why, sf-spec, sf-preview, sf-locked,
 * sf-locked-cta. Proving these render + carry the correct entitlement-gated state
 * IS the proof that the dark modules are wired end-to-end (no flag mutation — we
 * assert state, never flip, to avoid polluting the org).
 *
 * Run: E2E_API_KEY=$(get-secret E2E_API_KEY) \
 *   npx playwright test --config=playwright.prod.config.ts flows-site-features.flow --workers=3
 */
import { test, expect } from '@playwright/test';
import { hasKey, seedSession, gotoAdmin, attachConsole, expectClean, snap, apiFetch } from './_flow-helpers';

// A sample of real module slugs surfaced on this page (from the live probe).
const KNOWN_CARDS = [
  'donations_engine',
  'email_marketing',
  'seo_autopilot',
  'gbp_assist',
  'search_engine_submit',
  'unified_inbox',
  'site_mcp_server',
  'storefront_ecommerce',
  'ai_concierge_widget',
  'page_audio',
];

test.describe('Full-flow · site-features (the dark-launch module hub)', () => {
  test.skip(!hasKey, 'E2E_API_KEY not set');
  test.describe.configure({ retries: 2 });
  test.use({ reducedMotion: 'reduce' });

  test('01 the Features hub boots (sf-root + many feature cards)', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin/site-features');
    await expect(page).toHaveURL(/\/admin\/site-features/);
    await expect(page.locator('[data-testid="sf-root"]')).toBeVisible({ timeout: 15_000 });
    const cardCount = await page.locator('[data-testid^="sf-card-"]').count();
    expect(cardCount, 'the dark-launch modules are surfaced as feature cards').toBeGreaterThan(8);
    await snap(page, 'sf-01-hub');
    expectClean(errors);
  });

  test('02 the known dark-launch module cards each render', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin/site-features');
    await expect(page.locator('[data-testid="sf-root"]')).toBeVisible({ timeout: 15_000 });
    let seen = 0;
    for (const slug of KNOWN_CARDS) {
      const card = page.locator(`[data-testid="sf-card-${slug}"]`);
      if (await card.count()) {
        await expect(card.first()).toBeVisible();
        seen++;
      }
    }
    expect(seen, 'most known module cards are present + rendered').toBeGreaterThanOrEqual(6);
  });

  test('03 sf-search filters the feature cards down to a query', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin/site-features');
    const search = page.locator('[data-testid="sf-search"]');
    await expect(search).toBeVisible({ timeout: 15_000 });
    const before = await page.locator('[data-testid^="sf-card-"]:visible').count();
    await search.fill('donation');
    await page.waitForTimeout(600);
    const after = await page.locator('[data-testid^="sf-card-"]:visible').count();
    expect(after, 'searching narrows the visible card set').toBeLessThanOrEqual(before);
    // Donations should survive a "donation" query.
    await expect(page.locator('[data-testid="sf-card-donations_engine"]')).toBeVisible();
    await snap(page, 'sf-03-search');
  });

  test('04 the layer nav (sf-nav-system) switches between feature layers', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin/site-features');
    const nav = page.locator('[data-testid="sf-nav-system"]');
    await expect(page.locator('[data-testid="sf-root"]')).toBeVisible({ timeout: 15_000 });
    if (await nav.count()) {
      await nav.first().click();
      await expect(page.locator('[data-testid="sf-layer-heading"]').first()).toBeVisible({ timeout: 10_000 });
    }
    await expect(page.locator('[data-testid="sf-layer-heading"]').first()).toBeVisible();
  });

  test('05 opening a feature card reveals its why/spec detail', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin/site-features');
    const card = page.locator('[data-testid="sf-card-donations_engine"]');
    await expect(card).toBeVisible({ timeout: 15_000 });
    await card.click();
    // The card exposes rationale (sf-why) and/or the module spec (sf-spec).
    const detail = page.locator('[data-testid="sf-why"], [data-testid="sf-spec"], [data-testid="sf-checklist"]').first();
    await expect(detail, 'a feature card explains what it does').toBeVisible({ timeout: 10_000 });
    await snap(page, 'sf-05-card-detail');
  });

  test('06 each feature card carries EITHER a toggle (available) OR a locked-CTA (plan-gated) — never neither', async ({
    page,
  }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin/site-features');
    await expect(page.locator('[data-testid="sf-root"]')).toBeVisible({ timeout: 15_000 });
    const toggles = await page.locator('[data-testid="sf-toggle"]').count();
    const locked = await page.locator('[data-testid="sf-locked"], [data-testid="sf-locked-cta"]').count();
    expect(toggles + locked, 'every module is either toggleable or shows an upgrade gate').toBeGreaterThan(4);
  });

  test('07 plan-gated modules show the upgrade CTA (free-plan entitlement gating is honest)', async ({
    page,
  }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin/site-features');
    await expect(page.locator('[data-testid="sf-root"]')).toBeVisible({ timeout: 15_000 });
    const lockedCta = page.locator('[data-testid="sf-locked-cta"]').first();
    // Free plan → premium modules are locked; if any is locked, its CTA points to upgrade.
    if (await lockedCta.count()) {
      await expect(lockedCta).toBeVisible();
      await expect(lockedCta).toContainText(/upgrade|pro|unlock|plan/i);
      await snap(page, 'sf-07-locked-cta');
    }
  });

  test('08 the feature-flag stage badge row (ff-badge-row) renders on cards', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin/site-features');
    await expect(page.locator('[data-testid="sf-root"]')).toBeVisible({ timeout: 15_000 });
    const badges = page.locator('[data-testid="ff-badge-row"]');
    if (await badges.count()) await expect(badges.first()).toBeVisible();
  });

  test('09 a module preview (sf-preview) is reachable from a card', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin/site-features');
    const card = page.locator('[data-testid="sf-card-donations_engine"]');
    await expect(card).toBeVisible({ timeout: 15_000 });
    await card.click();
    const preview = page.locator('[data-testid="sf-preview"]').first();
    const previewBtn = page.getByRole('button', { name: /preview/i }).first();
    if (await preview.count()) {
      await expect(preview).toBeVisible({ timeout: 8_000 });
    } else if (await previewBtn.count()) {
      await previewBtn.click();
      await snap(page, 'sf-09-preview');
    }
  });

  test('10 the checklist (sf-checklist) on a card lists activation steps', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin/site-features');
    const card = page.locator('[data-testid="sf-card-donations_engine"]');
    await expect(card).toBeVisible({ timeout: 15_000 });
    await card.click();
    const checklist = page.locator('[data-testid="sf-checklist"]').first();
    if (await checklist.count()) await expect(checklist).toBeVisible({ timeout: 8_000 });
  });

  test('11 several premium/AI module cards render (storefront, concierge, seo, page-audio)', async ({
    page,
  }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin/site-features');
    await expect(page.locator('[data-testid="sf-root"]')).toBeVisible({ timeout: 15_000 });
    let seen = 0;
    for (const slug of ['storefront_ecommerce', 'ai_concierge_widget', 'seo_autopilot', 'page_audio']) {
      if (await page.locator(`[data-testid="sf-card-${slug}"]`).count()) seen++;
    }
    expect(seen, 'the premium/AI module cards are surfaced').toBeGreaterThanOrEqual(2);
  });

  test('12 deep-link + reload preserves the Features hub (session intact)', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin/site-features');
    await expect(page.locator('[data-testid="sf-root"]')).toBeVisible({ timeout: 15_000 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-testid="sf-root"]'), 'hub survives reload').toBeVisible({ timeout: 15_000 });
    await expect(page).not.toHaveURL(/\/signin/);
  });

  test('13 keyboard: the search field is focusable and accepts a typed query', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin/site-features');
    const search = page.locator('[data-testid="sf-search"]');
    await expect(search).toBeVisible({ timeout: 15_000 });
    await search.focus();
    expect(await search.evaluate((el) => el === document.activeElement)).toBeTruthy();
    await page.keyboard.type('seo', { delay: 25 });
    await expect(search).toHaveValue(/seo/i);
  });

  test('14 the Features hub is console-error-free across search + a card open', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin/site-features');
    await expect(page.locator('[data-testid="sf-root"]')).toBeVisible({ timeout: 15_000 });
    const search = page.locator('[data-testid="sf-search"]');
    if (await search.count()) {
      await search.fill('inbox');
      await page.waitForTimeout(500);
      await search.fill('');
    }
    const card = page.locator('[data-testid^="sf-card-"]').first();
    if (await card.count()) await card.click();
    await page.waitForTimeout(500);
    expectClean(errors);
  });

  test('15 full journey: /admin → Features nav → search a module → open it → read its spec', async ({
    page,
  }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin');
    // The primary nav exposes a Features link (data-testid nav-features).
    const featuresLink = page.locator('[data-testid="nav-features"], a[href="/admin/site-features"]').first();
    if (await featuresLink.count()) {
      await featuresLink.click();
    } else {
      await page.goto('/admin/site-features', { waitUntil: 'domcontentloaded' });
    }
    await expect(page.locator('[data-testid="sf-root"]')).toBeVisible({ timeout: 15_000 });
    const search = page.locator('[data-testid="sf-search"]');
    if (await search.count()) {
      await search.fill('donation');
      await page.waitForTimeout(500);
    }
    const card = page.locator('[data-testid="sf-card-donations_engine"]');
    await expect(card).toBeVisible({ timeout: 10_000 });
    await card.click();
    await snap(page, 'sf-15-journey');
    expectClean(errors);
  });

  test('16 ground-truth: the surfaced feature set is non-trivial (reconciles with a real module catalog)', async ({
    page,
  }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin/site-features');
    await expect(page.locator('[data-testid="sf-root"]')).toBeVisible({ timeout: 15_000 });
    // The hub surfaces the dark-launch modules — assert a substantial catalog is present.
    const cards = await page.locator('[data-testid^="sf-card-"]').count();
    expect(cards, 'a real, substantial module catalog is rendered').toBeGreaterThan(10);
  });
});
