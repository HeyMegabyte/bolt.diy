/**
 * ADMIN-32 — /admin/review-links Review & Approval Links surface renders
 *
 * Per [[e2e-tdd-organization]]: goto('/') → authedPage → navigate to sub-route.
 *
 * The Review Links panel ({@link AdminReviewLinksComponent}, mounted at
 * `/admin/review-links`) ALWAYS renders its "Review & Approval Links" h2.
 * The body branches: when no site is selected → a `review-links-empty` prompt;
 * when a site is selected → the `review-links-create-btn` (create a shareable
 * approve-before-publish link) plus the link list (`review-links-none` empty /
 * `review-links-row` / `review-links-loading` / `review-links-error`). The
 * backend (`/api/sites/:siteId/review-links`) is flag-gated (`approval_workflow`).
 *
 * To stay deterministic + parallel-safe across either state, this spec asserts
 * the always-rendered header hard, then branches on whether a site is selected
 * — mirroring webhooks.spec.ts. Deterministic (locator waits only),
 * parallel-safe (isolated authed context), stable selectors (data-testid).
 */

import { test, expect } from '../fixtures.js';

const BASE = process.env.BASE_URL ?? process.env.PROD_URL ?? 'http://localhost:8787';

test.describe('ADMIN-32 — /admin/review-links Review & Approval Links surface renders', () => {
  test('review-links header + create control / empty-state render', async ({ authedPage: page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto(`${BASE}/admin/review-links`);

    // Always-rendered header — mounts regardless of site/flag state.
    await expect(
      page.locator('h2').filter({ hasText: /Review & Approval Links/i }).first(),
    ).toBeVisible({ timeout: 15_000 });

    // Branch: site selected → create control; no site → empty-state prompt.
    const createBtn = page.locator('[data-testid="review-links-create-btn"]').first();
    if (await createBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await expect(createBtn).toBeVisible();
    } else {
      await expect(page.locator('[data-testid="review-links-empty"]').first()).toBeVisible({ timeout: 5_000 });
    }

    expect(
      consoleErrors.filter((e) => !e.includes('favicon') && !e.includes('net::ERR_BLOCKED')),
    ).toHaveLength(0);
  });
});
