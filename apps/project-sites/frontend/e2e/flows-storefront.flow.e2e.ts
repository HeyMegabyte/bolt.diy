/**
 * flows-storefront.flow.e2e.ts — Surface: the storefront product manager
 * (feature `storefront_ecommerce`), embedded in the feature-dossier opened from
 * /admin/site-features. Genuinely uncovered + SILENTLY BROKEN before this fire:
 * `storefront_products` was MISSING in prod (migration 0564, part of the
 * never-applied era killed by a legacy `INSERT INTO feature_flags(key,…)`), so the
 * product list lied-empty + creation failed. The flag `storefront_ecommerce` is
 * globally ON (the API gates on the FLAG, not the card's `requiredPlan:business`),
 * so the API works for any org. Fire-29 applied the table.
 *
 * Elaborate mutation journey against prod for e2e-site-3: open the storefront
 * dossier → create a uniquely-named product → assert the catalog row + ground-truth
 * (GET /products now has it) → DELETE → assert it's gone from the list AND the store.
 *
 * Real testids: sf-card-storefront_ecommerce, sf-spec, feature-dossier, sm-name,
 * sm-price, sm-add, sm-list, sm-edit. Delete = the row's ✕ (aria-label "Delete <name>").
 *
 * Run: E2E_API_KEY=$(get-secret E2E_API_KEY) \
 *   npx playwright test --config=playwright.prod.config.ts flows-storefront.flow --workers=1
 */
import { test, expect } from '@playwright/test';
import { hasKey, seedSession, gotoAdmin, attachConsole, expectClean, snap, apiFetch } from './_flow-helpers';

const SITE = 'e2e-site-3';
const MARK = 'e2e-prod';
const DOSSIER = '[data-testid="feature-dossier"]';
const MANAGER = '[data-testid="sm-name"]';

interface ProductsResp { products: { id: string; name: string }[] }

async function openStorefrontDossier(page: import('@playwright/test').Page) {
  await gotoAdmin(page, '/admin/site-features');
  // Filter to the storefront card, then open its spec dossier (the manager lives inside).
  const search = page.locator('[data-testid="sf-search"]');
  if (await search.count()) await search.fill('online store').catch(() => {});
  const card = page.locator('[data-testid="sf-card-storefront_ecommerce"]');
  await card.first().waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
  await card.locator('[data-testid="sf-spec"]').first().click().catch(() => {});
  await page.locator(DOSSIER).first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
}

test.describe('Full-flow · storefront product manager', () => {
  test.skip(!hasKey, 'E2E_API_KEY not set');
  test.describe.configure({ mode: 'serial', retries: 2 });
  test.use({ reducedMotion: 'reduce' });

  test('01 the storefront dossier opens and renders the product manager', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await openStorefrontDossier(page);
    await expect(page.locator(DOSSIER), 'the feature dossier opens').toBeVisible({ timeout: 15_000 });
    await expect(page.locator(MANAGER), 'the storefront manager renders inside').toBeVisible({ timeout: 10_000 });
    await snap(page, 'storefront-01-manager');
    expectClean(errors);
  });

  test('02 ground-truth: the products API is live (table now exists — no longer lying-empty)', async ({ page }) => {
    await seedSession(page);
    await openStorefrontDossier(page);
    const api = await apiFetch<ProductsResp>(page, `/api/sites/${SITE}/products`);
    expect(api.status, 'the products endpoint is 200 (table applied this fire)').toBe(200);
    expect(Array.isArray(api.body.products), 'products is a real array').toBe(true);
    // Self-heal: delete any e2e leftovers from a crashed prior run.
    for (const p of (api.body.products ?? []).filter((x) => x.name?.startsWith(MARK))) {
      await apiFetch(page, `/api/sites/${SITE}/products/${p.id}`, { method: 'DELETE' });
    }
  });

  test('03 lifecycle: add product → catalog row → ground-truth persisted → DELETE → gone', async ({ page }) => {
    test.setTimeout(60_000);
    const errors = attachConsole(page);
    await seedSession(page);
    await openStorefrontDossier(page);
    await expect(page.locator(MANAGER)).toBeVisible({ timeout: 15_000 });

    const name = `${MARK}-${Date.now()}`;
    await page.locator('[data-testid="sm-name"]').fill(name);
    await page.locator('[data-testid="sm-price"]').fill('24.99');
    const add = page.locator('[data-testid="sm-add"]');
    await expect(add).toBeEnabled({ timeout: 5_000 });
    await add.click();

    // The new product lands in the catalog list.
    await expect(page.locator('[data-testid="sm-list"]').filter({ hasText: name }), 'the product row renders').toBeVisible({ timeout: 15_000 });
    await snap(page, 'storefront-03-added');

    // Ground-truth: the store persisted it (poll for D1 replica lag).
    await expect(async () => {
      const after = await apiFetch<ProductsResp>(page, `/api/sites/${SITE}/products`);
      expect((after.body.products ?? []).some((p) => p.name === name)).toBe(true);
    }).toPass({ timeout: 15_000 });

    // DELETE the product (self-cleanup) — the row's ✕ button (aria-label "Delete <name>").
    const delBtn = page.getByRole('button', { name: `Delete ${name}` });
    await delBtn.click();
    const confirmBtn = page.locator('[data-testid="confirm-accept"]');
    if (await confirmBtn.isVisible({ timeout: 3_000 }).catch(() => false)) await confirmBtn.click().catch(() => {});

    // Ground-truth: it's gone from the store.
    await expect(async () => {
      const gone = await apiFetch<ProductsResp>(page, `/api/sites/${SITE}/products`);
      expect((gone.body.products ?? []).some((p) => p.name === name)).toBe(false);
    }).toPass({ timeout: 15_000 });
    expectClean(errors);
  });

  test('04 the add button is gated until a product name is entered', async ({ page }) => {
    await seedSession(page);
    await openStorefrontDossier(page);
    await expect(page.locator(MANAGER)).toBeVisible({ timeout: 15_000 });
    // Empty name → the add button is disabled (canAdd gate).
    await page.locator('[data-testid="sm-name"]').fill('');
    await expect(page.locator('[data-testid="sm-add"]')).toBeDisabled();
  });

  test('05 the storefront surface is console-error-free', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await openStorefrontDossier(page);
    await expect(page.locator(MANAGER)).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(400);
    expectClean(errors);
  });

  test('06 cleanup: no e2e products remain on the shared org', async ({ page }) => {
    await seedSession(page);
    await openStorefrontDossier(page);
    const api = await apiFetch<ProductsResp>(page, `/api/sites/${SITE}/products`);
    for (const p of (api.body.products ?? []).filter((x) => x.name?.startsWith(MARK))) {
      await apiFetch(page, `/api/sites/${SITE}/products/${p.id}`, { method: 'DELETE' });
    }
    const after = await apiFetch<ProductsResp>(page, `/api/sites/${SITE}/products`);
    expect((after.body.products ?? []).filter((p) => p.name?.startsWith(MARK)).length, 'no e2e products remain').toBe(0);
  });
});
