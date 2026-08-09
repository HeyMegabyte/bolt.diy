/**
 * @module e2e/roadmap
 *
 * The public `/roadmap` page — a Trello-style board (Planned / In Progress /
 * Shipped) backed by `GET /api/public/roadmap`. Wired 2026-08-09: the API +
 * MetaService entry + changelog announcement all pre-existed, but the
 * route/component were missing, so `/roadmap` soft-404'd to the not-found page.
 * This verifies the board renders with REAL populated data (live shipped
 * features), exactly one <h1>, three status columns, and stays console-clean.
 * Public page + public API → no session seed. Run:
 *   npx playwright test --config=playwright.prod.config.ts roadmap
 */
import { test, expect } from '@playwright/test';

test.describe('public /roadmap — Trello board, real data', () => {
  test.describe.configure({ retries: 2 });

  test('renders the status board populated with real shipped features', async ({ page }) => {
    test.setTimeout(45000);
    const errors: string[] = [];
    page.on('console', (m) => {
      if (
        m.type() === 'error' &&
        !/favicon|analytics|posthog|gtag|googletagmanager|Failed to load resource/i.test(m.text())
      ) {
        errors.push(m.text());
      }
    });
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto('/roadmap', { waitUntil: 'load' });

    // Exactly one <h1> (SEO + WCAG 1.3.1), and it's the roadmap title.
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('h1')).toContainText(/roadmap/i);

    // The three status columns render.
    const cols = page.locator('.rm-board [role="listitem"]');
    await expect(cols).toHaveCount(3, { timeout: 15000 });
    await expect(page.getByRole('heading', { name: /shipped/i })).toBeVisible();

    // Populated with REAL data from the live API — NOT an empty/stub state.
    const cards = page.locator('.rm-card');
    await expect.poll(async () => cards.count(), { timeout: 10000 }).toBeGreaterThan(3);
    // At least one real shipped feature title from GET /api/public/roadmap.
    await expect(
      page
        .locator('.rm-card-title')
        .filter({ hasText: /voice|apps|inbox|social|integration/i })
        .first(),
    ).toBeVisible();
    // Every card carries a real quarter chip (e.g. "Q2 2026") — no blank cards.
    await expect(page.locator('.rm-chip').first()).toContainText(/Q[1-4]\s*20\d{2}/);

    // Console-clean (no CSP/JS/Trusted-Types errors).
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('is the real board, not the soft-404 not-found page', async ({ page }) => {
    await page.goto('/roadmap', { waitUntil: 'load' });
    // Before wiring, /roadmap fell through to the public not-found ("Popular
    // pages", `.links-heading`). Assert the board is present + no not-found marker.
    await expect(page.locator('.rm-board')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.links-heading, [data-testid="admin-not-found"]')).toHaveCount(0);
  });
});
