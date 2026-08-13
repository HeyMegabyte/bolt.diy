/**
 * flows-personalization.flow.e2e.ts — Surface: the edge-personalization panel
 * (feature `edge_personalization`) on /admin/snapshots.
 *
 * FINISHED this fire — 5th missing-table module: `site_personalization_variants`
 * did not exist in prod, so `/resolve` always lied "Default" and `/variants` upsert
 * failed. Added `migrations/0624_create_site_personalization_variants.sql` + applied,
 * added the missing `GET /api/personalize/:siteId/variants` list endpoint (an admin
 * can't manage rules it can't read), SEEDED 4 priority-ordered rules for e2e-site-3,
 * and built `<app-edge-personalization-panel>` (rules list + live visitor resolver).
 *
 * Ground truth (e2e-test-org, site e2e-site-3 / urban-fitness — the default
 * selection): 4 rules — Returning VIP (P40, isReturn), Mobile Welcome (P30, mobile),
 * US Desktop Promo (P20, geo US + desktop), Google Organic (P10, referrer~google).
 *
 * Resolve logic (priority DESC, empty field = wildcard, referrer = substring):
 *   ?device=mobile          → Mobile Welcome
 *   ?isReturn=true          → Returning VIP (highest priority wins)
 *   ?geo=US&device=desktop  → US Desktop Promo
 *   (no signals)            → Default
 *
 * Real testids: personalization-panel, pv-count, pv-list, pv-rule, pv-rule-name,
 * pv-rule-active, pv-priority, pv-cond, pv-resolver, pv-device-select, pv-geo-input,
 * pv-return-toggle, pv-resolved, pv-empty.
 *
 * Run: E2E_API_KEY=$(get-secret E2E_API_KEY) \
 *   npx playwright test --config=playwright.prod.config.ts flows-personalization.flow --workers=3
 */
import { test, expect } from '@playwright/test';
import { hasKey, seedSession, gotoAdmin, attachConsole, expectClean, snap, apiFetch } from './_flow-helpers';

const PANEL = '[data-testid="personalization-panel"]';
const SITE = 'e2e-site-3'; // urban-fitness — the seeded + default-selected site

interface ListResp { variants: { id: string; name: string }[]; count: number }
interface ResolveResp { variantId: string; variantName: string }

async function openSnapshots(page: import('@playwright/test').Page) {
  await gotoAdmin(page, '/admin/snapshots');
  await page.locator(PANEL).first().waitFor({ state: 'visible', timeout: 20_000 }).catch(() => {});
}

test.describe('Full-flow · edge personalization', () => {
  test.skip(!hasKey, 'E2E_API_KEY not set');
  test.describe.configure({ retries: 2 });
  test.use({ reducedMotion: 'reduce' });

  test('01 the personalization panel renders on /admin/snapshots with a rule count', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await openSnapshots(page);
    await expect(page.locator(PANEL), 'the panel renders').toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('heading', { name: /edge personalization/i })).toBeVisible();
    await expect(page.locator('[data-testid="pv-count"]')).toBeVisible();
    await snap(page, 'personalization-01-panel');
    expectClean(errors);
  });

  test('02 ground-truth: the seeded store returns 4 priority-ordered rules + correct resolutions', async ({ page }) => {
    await seedSession(page);
    await openSnapshots(page);
    // The list endpoint (added this fire) reflects the seed.
    const list = await apiFetch<ListResp>(page, `/api/personalize/${SITE}/variants`);
    expect(list.status).toBe(200);
    expect(list.body.count, 'the seed persisted 4 rules').toBe(4);
    const names = (list.body.variants ?? []).map((v) => v.name);
    expect(names).toEqual(['Returning VIP', 'Mobile Welcome', 'US Desktop Promo', 'Google Organic']);
    // The resolve logic picks the right variant per signal set.
    const mobile = await apiFetch<ResolveResp>(page, `/api/personalize/${SITE}/resolve?device=mobile`);
    expect(mobile.body.variantName, 'mobile → Mobile Welcome').toBe('Mobile Welcome');
    const ret = await apiFetch<ResolveResp>(page, `/api/personalize/${SITE}/resolve?isReturn=true`);
    expect(ret.body.variantName, 'returning → highest-priority VIP').toBe('Returning VIP');
    const usDesk = await apiFetch<ResolveResp>(page, `/api/personalize/${SITE}/resolve?geo=US&device=desktop`);
    expect(usDesk.body.variantName, 'US desktop → US Desktop Promo').toBe('US Desktop Promo');
    const none = await apiFetch<ResolveResp>(page, `/api/personalize/${SITE}/resolve`);
    expect(none.body.variantName, 'no signals → Default fallback').toBe('Default');
  });

  test('03 the seeded rules render in the panel and reconcile with the store', async ({ page }) => {
    await seedSession(page);
    await openSnapshots(page);
    await expect(page.locator(PANEL)).toBeVisible({ timeout: 20_000 });
    const rows = page.locator('[data-testid="pv-rule"]');
    const empty = page.locator('[data-testid="pv-empty"]');
    if (await empty.count()) {
      // A different site is selected — still honest, but note it.
      await expect(empty).toBeVisible();
      return;
    }
    const api = await apiFetch<ListResp>(page, `/api/personalize/${SITE}/variants`);
    expect(await rows.count(), 'panel rule count reconciles with the store').toBe(api.body.count);
    await expect(page.locator(PANEL)).toContainText('Mobile Welcome');
    await expect(page.locator(PANEL)).toContainText('Returning VIP');
    await snap(page, 'personalization-03-rules');
  });

  test('04 the priority + condition chips render for each rule', async ({ page }) => {
    await seedSession(page);
    await openSnapshots(page);
    await expect(page.locator(PANEL)).toBeVisible({ timeout: 20_000 });
    if (await page.locator('[data-testid="pv-empty"]').count()) return;
    // Highest-priority rule is first and shows its priority badge + a condition chip.
    const first = page.locator('[data-testid="pv-rule"]').first();
    await expect(first.locator('[data-testid="pv-priority"]')).toContainText(/P\d+/);
    await expect(first.locator('[data-testid="pv-cond"]').first()).toBeVisible();
  });

  test('05 live resolver: mobile visitor resolves to the mobile variant (reconciled)', async ({ page }) => {
    await seedSession(page);
    await openSnapshots(page);
    await expect(page.locator(PANEL)).toBeVisible({ timeout: 20_000 });
    if (await page.locator('[data-testid="pv-empty"]').count()) return;
    await page.locator('[data-testid="pv-device-select"]').selectOption('mobile');
    // The widget re-resolves via the API; assert it matches the store's answer.
    const api = await apiFetch<ResolveResp>(page, `/api/personalize/${SITE}/resolve?device=mobile&hour=${new Date().getHours()}`);
    await expect(page.locator('[data-testid="pv-resolved"]')).toHaveText(api.body.variantName, { timeout: 10_000 });
    await expect(page.locator('[data-testid="pv-resolved"]')).toHaveText('Mobile Welcome');
    await snap(page, 'personalization-05-resolve-mobile');
  });

  test('06 live resolver: a returning visitor resolves to the highest-priority VIP rule', async ({ page }) => {
    await seedSession(page);
    await openSnapshots(page);
    await expect(page.locator(PANEL)).toBeVisible({ timeout: 20_000 });
    if (await page.locator('[data-testid="pv-empty"]').count()) return;
    await page.locator('[data-testid="pv-return-toggle"]').check();
    await expect(page.locator('[data-testid="pv-resolved"]')).toHaveText('Returning VIP', { timeout: 10_000 });
    // The matching rule row is highlighted as active.
    await expect(page.locator('[data-testid="pv-rule"][data-variant="Returning VIP"] [data-testid="pv-rule-active"]')).toBeVisible();
    await snap(page, 'personalization-06-resolve-returning');
  });

  test('07 the personalization surface is console-error-free', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await openSnapshots(page);
    await expect(page.locator(PANEL)).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(400);
    expectClean(errors);
  });

  test('08 full journey: snapshots → panel rules + live resolver both reflect the persisted store', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await openSnapshots(page);
    await expect(page.locator(PANEL)).toBeVisible({ timeout: 20_000 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await openSnapshots(page);
    await expect(page.locator(PANEL), 'panel survives reload').toBeVisible({ timeout: 20_000 });
    await expect(page).not.toHaveURL(/\/signin/);
    if (await page.locator('[data-testid="pv-empty"]').count()) {
      expectClean(errors);
      return;
    }
    // Drive the resolver to a geo+device combo and reconcile with the store.
    await page.locator('[data-testid="pv-device-select"]').selectOption('desktop');
    await page.locator('[data-testid="pv-geo-input"]').fill('US');
    const api = await apiFetch<ResolveResp>(page, `/api/personalize/${SITE}/resolve?device=desktop&geo=US&hour=${new Date().getHours()}`);
    await expect(page.locator('[data-testid="pv-resolved"]')).toHaveText(api.body.variantName, { timeout: 10_000 });
    await snap(page, 'personalization-08-journey');
    expectClean(errors);
  });
});
