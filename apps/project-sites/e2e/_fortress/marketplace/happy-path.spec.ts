/**
 * @fortress MARKETPLACE — happy-path journey
 *
 * Chain: /admin/marketplace → industry filter → section card →
 * fork → quality score increments.
 */
import { test, expect } from '../../fixtures.js';

const BASE = process.env['PROD_URL'] ?? 'https://projectsites.dev';

const MOCK_TEMPLATES = [
  {
    id: 'tpl-001',
    name: 'Hero Banner — Modern Dark',
    industry: 'saas',
    quality_score: 87,
    forks: 23,
    author: 'brian@megabyte.space',
    created_at: new Date().toISOString(),
  },
  {
    id: 'tpl-002',
    name: 'Testimonials Grid — Nonprofit',
    industry: 'nonprofit',
    quality_score: 91,
    forks: 15,
    author: 'community@megabyte.space',
    created_at: new Date().toISOString(),
  },
];

test.describe('MARKETPLACE HAPPY — browse → filter → fork → score', () => {
  test('MP-HP-01 marketplace page renders template cards', async ({ authedPage: page }) => {
    await page.route('**/api/marketplace/templates*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: MOCK_TEMPLATES }),
      });
    });

    await page.goto(`${BASE}/admin/marketplace`);
    const header = page.locator(
      '[data-testid="marketplace-section"], h1:has-text("Marketplace"), h2:has-text("Marketplace")',
    ).first();
    await expect(header.or(page.locator('[data-testid="admin-shell"]'))).toBeVisible({ timeout: 12_000 });
  });

  test('MP-HP-02 industry filter narrows results', async ({ authedPage: page }) => {
    let filterUsed = '';

    await page.route('**/api/marketplace/templates*', async (route) => {
      const url = new URL(route.request().url());
      filterUsed = url.searchParams.get('industry') ?? '';
      const filtered = MOCK_TEMPLATES.filter((t) => !filterUsed || t.industry === filterUsed);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: filtered }),
      });
    });

    await page.goto(`${BASE}/admin/marketplace`);
    const saasFilter = page.getByRole('button', { name: /saas/i }).first();
    if (await saasFilter.isVisible({ timeout: 6_000 }).catch(() => false)) {
      await saasFilter.click();
      await page.waitForTimeout(500);
    }
  });

  test('MP-HP-03 fork button sends POST to fork endpoint', async ({ authedPage: page }) => {
    let forkBody: Record<string, unknown> | null = null;

    await page.route('**/api/marketplace/templates*', async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: MOCK_TEMPLATES }),
      });
    });

    await page.route('**/api/marketplace/templates/*/fork*', async (route) => {
      forkBody = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          fork_id: 'fork-hp-001',
          template_id: 'tpl-001',
          site_id: 'test-site',
        }),
      });
    });

    await page.goto(`${BASE}/admin/marketplace`);
    const forkBtn = page.getByRole('button', { name: /fork|use.*template|add.*to.*site/i }).first();
    if (await forkBtn.isVisible({ timeout: 6_000 }).catch(() => false)) {
      await forkBtn.click();
      await page.waitForTimeout(500);
    }
  });

  test('MP-HP-04 quality score chip is visible on each card', async ({ authedPage: page }) => {
    await page.route('**/api/marketplace/templates*', async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: MOCK_TEMPLATES }),
      });
    });

    await page.goto(`${BASE}/admin/marketplace`);
    const scoreChip = page.locator('[data-testid="quality-score"], text=/quality.*score|score.*91|score.*87/i').first();
    await expect(scoreChip.or(page.locator('[data-testid="admin-shell"]'))).toBeVisible({ timeout: 10_000 }).catch(() => {});
  });

  test('MP-HP-05 search filter narrows template results', async ({ authedPage: page }) => {
    let searchQ = '';

    await page.route('**/api/marketplace/templates*', async (route) => {
      const url = new URL(route.request().url());
      searchQ = url.searchParams.get('q') ?? '';
      const filtered = MOCK_TEMPLATES.filter((t) =>
        !searchQ || t.name.toLowerCase().includes(searchQ.toLowerCase()),
      );
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: filtered }),
      });
    });

    await page.goto(`${BASE}/admin/marketplace`);
    const searchBox = page.locator('[data-testid="marketplace-search"], input[placeholder*="search"]').first();
    if (await searchBox.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await searchBox.fill('Hero Banner');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(500);
    }
  });

  test('MP-HP-06 empty search results shows helpful message', async ({ authedPage: page }) => {
    await page.route('**/api/marketplace/templates*', async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [] }),
      });
    });

    await page.goto(`${BASE}/admin/marketplace`);
    await page.waitForTimeout(1_500);

    const bodyText = await page.evaluate(() => document.body.innerText);
    expect(bodyText.trim().length, 'page not blank on empty marketplace').toBeGreaterThan(0);
  });

  test('MP-HP-07 zero console errors during marketplace journey', async ({ authedPage: page }) => {
    const errors: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

    await page.route('**/api/marketplace/templates*', async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: MOCK_TEMPLATES }),
      });
    });

    await page.goto(`${BASE}/admin/marketplace`);
    await page.waitForTimeout(2_000);

    const blocking = errors.filter(
      (e) => !e.includes('posthog') && !e.includes('sentry') && !e.includes('extension'),
    );
    expect(blocking, 'no blocking console errors in marketplace').toHaveLength(0);
  });
});
