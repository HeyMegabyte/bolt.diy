/**
 * @module e2e/admin-feature-flags
 *
 * Regression guard for the feature-flags admin fixes (rounds 140-143):
 *   - #140 the flag-detail "Resolved state" renders FORMATTED chips
 *     (`.ff-resolved` + state badge / rollout / stage / source), NOT a raw
 *     `<pre>{{ … | json }}</pre>` JSON dump.
 *   - #143 the stage control is READ-ONLY (no editable `<select>` in the
 *     controls) — stage is registry/code-managed, not API-mutable. The rollout
 *     `<input type=range>` IS still interactive.
 *   - #141 flag mutations POST to the REAL endpoint `/api/super-admin/feature-flags`
 *     (the prior `/api/admin/feature-flags/:key/override` route 404'd), so the
 *     controls actually toggle flags. The test token is not a super-admin, so the
 *     POST resolves 401 — but we only assert it hits the right URL (correct
 *     wiring), not the response.
 *
 * Seeds `ps_session` from `E2E_API_KEY`. Run: `npm run test:e2e:prod`.
 */
import { test, expect, type Page } from '@playwright/test';

const KEY = process.env.E2E_API_KEY ?? '';

async function seed(page: Page): Promise<void> {
  await page.addInitScript((k: string) => {
    try {
      localStorage.setItem('ps_session', JSON.stringify({ token: k, identifier: 'test@megabyte.space', createdAt: Date.now() }));
      localStorage.setItem('ps_feedback_dismissed', 'true');
    } catch { /* private mode */ }
  }, KEY);
}

/** Open the first flag card's detail panel (the "Inspect" toggle). */
async function openFirstDetail(page: Page): Promise<void> {
  await expect(page.locator('.ff-card').first()).toBeVisible({ timeout: 30000 });
  const inspect = page.locator('.ff-card').first().getByRole('button', { name: /inspect/i });
  await inspect.click();
  await expect(page.locator('.ff-detail').first()).toBeVisible({ timeout: 15000 });
}

test.describe('admin /feature-flags — flag-control regressions (rounds 140-143)', () => {
  test.skip(!KEY, 'E2E_API_KEY not set');
  test.describe.configure({ retries: 2 });

  test('detail renders a formatted resolved-state, not a raw JSON dump', async ({ page }) => {
    test.setTimeout(60000);
    await seed(page);
    await page.goto('/admin/feature-flags', { waitUntil: 'load' });
    await openFirstDetail(page);

    // #140 — formatted chips present…
    const resolved = page.locator('.ff-resolved').first();
    await expect(resolved).toBeVisible({ timeout: 10000 });
    await expect(resolved).toContainText(/resolved via/i);
    // …and NO raw JSON `<pre>` with an "enabled" key anywhere in a detail panel.
    const rawJson = await page.locator('.ff-detail pre').evaluateAll(
      (els) => els.some((e) => /\{[\s\S]*"enabled"/.test(e.textContent ?? '')),
    );
    expect(rawJson, 'resolved-state must not be a raw JSON <pre>').toBe(false);
  });

  test('stage control is read-only; rollout slider stays interactive', async ({ page }) => {
    test.setTimeout(60000);
    await seed(page);
    await page.goto('/admin/feature-flags', { waitUntil: 'load' });
    await openFirstDetail(page);

    // #143 — no editable <select> in the controls (stage is registry-managed)…
    await expect(page.locator('.ff-controls select')).toHaveCount(0);
    // …a read-only stage chip is shown, and the rollout range input persists.
    await expect(page.locator('.ff-controls .ff-stage').first()).toBeVisible();
    await expect(page.locator('.ff-controls input[type="range"]').first()).toBeVisible();
  });

  test('flag mutation POSTs to the real /api/super-admin/feature-flags endpoint', async ({ page }) => {
    test.setTimeout(60000);
    await seed(page);
    await page.goto('/admin/feature-flags', { waitUntil: 'load' });

    // #141 — clicking a global toggle must hit the super-admin endpoint, never
    // the dead /override path. waitForRequest captures the request regardless of
    // its (401, non-super-admin) response. Use the 3rd card, not the 1st:
    // core_auth is the always-on control-plane SENTINEL whose toggle is a no-op
    // (it never fires a mutation), so target a normal flag instead.
    await expect(page.locator('.ff-card').first()).toBeVisible({ timeout: 30000 });
    const card = page.locator('.ff-card').nth(2);
    await expect(card).toBeVisible({ timeout: 15000 });
    const toggle = card.locator('button', { hasText: /globally/i });
    await expect(toggle).toBeVisible({ timeout: 10000 });

    const reqPromise = page.waitForRequest(
      (r) => r.method() === 'POST' && /\/api\/super-admin\/feature-flags/.test(r.url()),
      { timeout: 15000 },
    );
    await toggle.click();
    const req = await reqPromise;
    expect(req.url()).toContain('/api/super-admin/feature-flags');
    // The dead override path must NOT be what the UI calls.
    expect(req.url()).not.toContain('/override');
  });
});
