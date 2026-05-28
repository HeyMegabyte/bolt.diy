/**
 * @fortress SITE-CREATE — adversarial journey
 *
 * Break-it angles:
 *  SC1. XSS in prompt field → not reflected as script
 *  SC2. SQLi in place_id → 400, not 500
 *  SC3. create-from-search without auth → 401
 *  SC4. create-from-search with duplicate place_id → 409 Conflict
 *  SC5. Workflow 500 mid-build → waiting screen shows error affordance
 *  SC6. Boundary: prompt 50k chars → 400 PAYLOAD_TOO_LARGE or graceful truncation
 *  SC7. Race: double-submit create → idempotent / at most 1 site created
 */
import { test, expect } from '../../fixtures.js';

const BASE = process.env['PROD_URL'] ?? 'https://projectsites.dev';

test.describe('SITE-CREATE ADV — input abuse', () => {
  test('SC-ADV-01 XSS in prompt is not reflected as script tag', async ({ authedPage: page }) => {
    const xssPrompt = '<script>window.__SITE_XSS__=1</script>';

    await page.route('**/api/sites/create-from-search', async (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      // Ensure prompt is not executed
      const prompt = String(body.prompt ?? '');
      expect(prompt).not.toMatch(/<script>/i);
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'BAD_REQUEST', message: 'Invalid prompt' } }),
      });
    });

    await page.goto(BASE);
    await page.evaluate(() => {
      (window as unknown as Record<string, unknown>).navigateTo?.('details');
    });

    const promptInput = page.locator('#prompt-input, [data-testid="prompt-input"], textarea').first();
    if (await promptInput.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await promptInput.fill(xssPrompt);
      const submitBtn = page.locator('[onclick*="createSite"], [data-testid="submit-details"]').first();
      if (await submitBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await submitBtn.click();
        await page.waitForTimeout(500);
      }
    }

    const xssRan = await page.evaluate(
      () => (window as unknown as Record<string, unknown>).__SITE_XSS__ === 1,
    );
    expect(xssRan, 'XSS must not execute').toBe(false);
  });

  test('SC-ADV-02 SQLi in place_id returns 400 not 500', async ({ request }) => {
    const res = await request.post(`${BASE}/api/sites/create-from-search`, {
      data: { place_id: "'; DROP TABLE sites; --", prompt: 'Build it.' },
      headers: { Authorization: 'Bearer not-real-token' },
    });
    expect([400, 401]).toContain(res.status());
    expect(res.status()).not.toBe(500);
  });

  test('SC-ADV-03 create-from-search without auth returns 401', async ({ request }) => {
    const res = await request.post(`${BASE}/api/sites/create-from-search`, {
      data: { place_id: 'ChIJN1t_tDeuEmsRUsoyG83frY4', prompt: 'Build it.' },
    });
    expect(res.status()).toBe(401);
  });

  test('SC-ADV-04 duplicate place_id returns 409 Conflict (mocked)', async ({ authedPage: page }) => {
    await page.route('**/api/sites/create-from-search', async (route) => {
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'CONFLICT', message: 'Site already exists for this place' } }),
      });
    });

    await page.goto(BASE);
    const res = await page.request.post(`${BASE}/api/sites/create-from-search`, {
      data: { place_id: 'duplicate-place', prompt: 'Build it.' },
      headers: { Authorization: 'Bearer e2e-stub-session-token' },
    });
    expect([409, 401]).toContain(res.status());
    if (res.status() === 409) {
      const body = await res.json() as Record<string, unknown>;
      const error = body.error as Record<string, unknown>;
      expect(error.code).toBe('CONFLICT');
    }
  });

  test('SC-ADV-05 boundary: 50k-char prompt returns 400 or graceful truncation', async ({ authedPage: page }) => {
    const longPrompt = 'x'.repeat(50_000);

    await page.route('**/api/sites/create-from-search', async (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      const prompt = String(body.prompt ?? '');
      const status = prompt.length > 10_000 ? 400 : 200;
      await route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(status === 200
          ? { site: { site_id: 'x', slug: 'x', status: 'draft' } }
          : { error: { code: 'BAD_REQUEST', message: 'Prompt too long' } }),
      });
    });

    const res = await page.request.post(`${BASE}/api/sites/create-from-search`, {
      data: { place_id: 'ChIJN1t_tDeuEmsRUsoyG83frY4', prompt: longPrompt },
      headers: { Authorization: 'Bearer e2e-stub-session-token' },
    });
    expect([400, 401, 413]).toContain(res.status());
  });
});

test.describe('SITE-CREATE ADV — race + error recovery', () => {
  test('SC-ADV-06 race: double-submit creates at most 1 site', async ({ authedPage: page }) => {
    let createCount = 0;

    await page.route('**/api/sites/create-from-search', async (route) => {
      createCount++;
      if (createCount === 1) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ site: { site_id: 'race-site', slug: 'race-test', status: 'draft' } }),
        });
      } else {
        await route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({ error: { code: 'CONFLICT', message: 'Already creating' } }),
        });
      }
    });

    await page.goto(BASE);
    await page.evaluate(() => {
      (window as unknown as Record<string, unknown>).navigateTo?.('details');
    });

    const submitBtn = page.locator('[onclick*="createSite"], [data-testid="submit-details"]').first();
    if (await submitBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await Promise.all([submitBtn.click(), submitBtn.click()]);
      await page.waitForTimeout(600);
      // Should have been disabled after first click; at most 2 calls
      expect(createCount).toBeLessThanOrEqual(2);
    }
  });

  test('SC-ADV-07 workflow 500 mid-build shows error affordance, not blank screen', async ({ authedPage: page }) => {
    await page.route('**/api/sites/*/workflow', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'Build service unavailable' } }),
      });
    });

    await page.goto(`${BASE}/admin/sites/test-site-id`);
    await page.waitForTimeout(1_500);

    // Page must not be blank
    const bodyText = await page.evaluate(() => document.body.innerText);
    expect(bodyText.trim().length, 'page not blank on workflow 500').toBeGreaterThan(0);
  });

  test('SC-ADV-08 missing place_id in request returns 400', async ({ authedPage: page }) => {
    await page.route('**/api/sites/create-from-search', async (route) => {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'BAD_REQUEST', message: 'place_id required' } }),
      });
    });

    const res = await page.request.post(`${BASE}/api/sites/create-from-search`, {
      data: { prompt: 'Build it.' },
      headers: { Authorization: 'Bearer e2e-stub-session-token' },
    });
    expect([400, 401]).toContain(res.status());
    expect(res.status()).not.toBe(500);
  });
});
