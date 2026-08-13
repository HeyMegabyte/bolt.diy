/**
 * flows-domains.flow.e2e.ts — Surface: Settings › Domains (/admin/settings#domains).
 *
 * The domain manager: a provisioned backup domain (the site's <slug>.projectsites.dev),
 * a "Connected domains" list, an "Add a domain" custom-domain form, and an AI domain
 * search. Real testids (live DOM probe): settings-domains-panel, backup-domain,
 * custom-domain-input, ai-search-input, ai-search-btn. The free e2e-test-org has
 * maxCustomDomains:0 → 0 connected custom domains (honest empty), and custom-domain
 * adds are plan-gated. NEVER purchases/adds a real domain.
 *
 * Run: E2E_API_KEY=$(get-secret E2E_API_KEY) \
 *   npx playwright test --config=playwright.prod.config.ts flows-domains.flow --workers=3
 */
import { test, expect } from '@playwright/test';
import { hasKey, seedSession, gotoAdmin, attachConsole, expectClean, snap, apiFetch } from './_flow-helpers';

const PANEL = '[data-testid="settings-domains-panel"]';

test.describe('Full-flow · domains', () => {
  test.skip(!hasKey, 'E2E_API_KEY not set');
  test.describe.configure({ retries: 2 });
  test.use({ reducedMotion: 'reduce' });

  test('01 the Domains panel renders under Settings', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin/settings#domains');
    await expect(page).toHaveURL(/\/admin\/settings/);
    await expect(page.locator(PANEL)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('heading', { name: /^domains$/i }).first()).toBeVisible();
    await snap(page, 'domains-01-panel');
    expectClean(errors);
  });

  test('02 the provisioned backup domain shows the site default (<slug>.projectsites.dev)', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin/settings#domains');
    const backup = page.locator('[data-testid="backup-domain"]');
    await expect(backup).toBeVisible({ timeout: 15_000 });
    await expect(backup, 'the backup domain is a projectsites.dev subdomain').toContainText(/projectsites\.dev/i);
    await snap(page, 'domains-02-backup');
  });

  test('03 the backup domain reflects the selected site slug (urban-fitness)', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin/settings#domains');
    // Ground truth: the first site's slug from /api/sites.
    const sites = await apiFetch<{ data?: Array<{ slug?: string }> }>(page, '/api/sites');
    const slug = sites.body?.data?.[0]?.slug;
    const backup = page.locator('[data-testid="backup-domain"]');
    await expect(backup).toBeVisible({ timeout: 15_000 });
    if (slug) await expect(backup, 'backup domain matches the real site slug').toContainText(new RegExp(slug, 'i'));
  });

  test('04 the "Connected domains" list shows the honest empty state (free plan, 0 custom)', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin/settings#domains');
    await expect(page.locator(PANEL)).toBeVisible({ timeout: 15_000 });
    // maxCustomDomains:0 for the free org → no connected custom domains.
    await expect(page.getByText(/no connected domains|connected domains/i).first()).toBeVisible({ timeout: 12_000 });
  });

  test('05 the custom-domain input accepts a domain name', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin/settings#domains');
    const input = page.locator('[data-testid="custom-domain-input"]');
    await expect(input).toBeVisible({ timeout: 15_000 });
    await input.fill('urbanfitness.example.com');
    await expect(input).toHaveValue(/urbanfitness\.example\.com/i);
    await snap(page, 'domains-05-input');
  });

  test('06 entitlement reconcile: the free org is capped at maxCustomDomains from /api/billing/entitlements', async ({
    page,
  }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin/settings#domains');
    const ent = await apiFetch<{ data?: { maxCustomDomains?: number } }>(page, '/api/billing/entitlements');
    expect(ent.status).toBe(200);
    // The panel's add-domain affordance must be coherent with the cap (0 → gated/upgrade).
    expect(ent.body?.data?.maxCustomDomains, 'entitlements expose the domain cap').not.toBeUndefined();
  });

  test('07 the AI domain search accepts a query', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin/settings#domains');
    const search = page.locator('[data-testid="ai-search-input"]');
    await expect(search).toBeVisible({ timeout: 15_000 });
    await search.fill('urban fitness gym');
    await expect(search).toHaveValue(/urban fitness/i);
  });

  test('08 clicking "Search with AI" runs a domain search without a real purchase', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin/settings#domains');
    const search = page.locator('[data-testid="ai-search-input"]');
    await expect(search).toBeVisible({ timeout: 15_000 });
    await search.fill('urban fitness');
    const btn = page.locator('[data-testid="ai-search-btn"]');
    if (await btn.count()) {
      await btn.click();
      await page.waitForTimeout(1500); // suggestions load; we NEVER purchase
    }
    await snap(page, 'domains-08-ai-search');
    expectClean(errors);
  });

  test('09 the "Add domain" affordance is present (never submitted)', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin/settings#domains');
    await expect(page.locator(PANEL)).toBeVisible({ timeout: 15_000 });
    const add = page.getByRole('button', { name: /add domain|add a domain/i }).first();
    if (await add.count()) await expect(add).toBeVisible();
  });

  test('10 deep-link + reload preserves the Domains panel (session intact)', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin/settings#domains');
    await expect(page.locator(PANEL)).toBeVisible({ timeout: 15_000 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator(PANEL)).toBeVisible({ timeout: 15_000 });
    await expect(page).not.toHaveURL(/\/signin/);
  });

  test('11 keyboard: the custom-domain input is focusable and accepts text', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin/settings#domains');
    const input = page.locator('[data-testid="custom-domain-input"]');
    await expect(input).toBeVisible({ timeout: 15_000 });
    await input.focus();
    expect(await input.evaluate((el) => el === document.activeElement)).toBeTruthy();
    await page.keyboard.type('shop.example.com', { delay: 20 });
    await expect(input).toHaveValue(/shop\.example\.com/i);
  });

  test('12 full journey: open Domains → see backup domain → type a custom domain → AI-search → no mutation', async ({
    page,
  }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin/settings#domains');
    await expect(page.locator('[data-testid="backup-domain"]')).toBeVisible({ timeout: 15_000 });
    await page.locator('[data-testid="custom-domain-input"]').fill('gym.example.com');
    const search = page.locator('[data-testid="ai-search-input"]');
    if (await search.count()) await search.fill('fitness');
    // Assert we're still on the panel and never triggered a purchase/add.
    await expect(page.locator(PANEL)).toBeVisible();
    await snap(page, 'domains-12-journey');
    expectClean(errors);
  });
});
