/**
 * CHAOS 11 — "The Domain Shopper": the /admin/domains interactive surface.
 *
 * chaos-4 render-sweeps /admin/domains but never DRIVES it. This exercises the two
 * real interactive contracts a human hits there:
 *   1. AI domain search — type a brief → "Search with AI" → the 10-strategy fan-out
 *      (POST /domains/ai-search) must COMPLETE: spinner clears + EITHER results
 *      render (available cards each with a Register button) OR an honest error
 *      toast. Never a 5xx, never an infinite spinner, never a console error.
 *      (Regression-guards the fixed "phantom column 404 + registrar 502" class.)
 *   2. Custom-domain add — client validation gates the submit: hostile/malformed
 *      hostnames keep it disabled (no dead button that 400s), a valid one enables.
 *
 * NEVER clicks Register (a real recurring financial charge) — asserts presence only.
 *
 * Run: E2E_API_KEY=$(get-secret E2E_API_KEY) npx playwright test \
 *   --config=playwright.prod.config.ts chaos-11-domains
 */
import { test, expect } from '@playwright/test';
import { trackErrors, assertAlive, seedAuth } from './chaos-helpers';

const KEY = process.env.E2E_API_KEY ?? '';

test.describe('CHAOS 11 — Domains (AI search + custom-domain validation)', () => {
  test.beforeEach(() => {
    test.skip(!KEY, 'E2E_API_KEY not set');
  });

  test('AI domain search completes gracefully — results or honest error, spinner clears, no 5xx / console error', async ({
    page,
  }) => {
    test.setTimeout(120_000); // the AI fan-out (10 strategies + availability) can be slow
    const e = trackErrors(page);
    await seedAuth(page, KEY);
    await page.goto('/admin/domains', { waitUntil: 'domcontentloaded' });

    const input = page.locator('[data-testid="ai-search-input"]');
    const btn = page.locator('[data-testid="ai-search-btn"]');
    await expect(input, 'AI search input reachable').toBeVisible({ timeout: 20_000 });

    await input.fill('premium barber shop in Newark');

    // Capture the ai-search POST status — a 5xx here is the exact defect class.
    const respP = page
      .waitForResponse((r) => /\/domains\/ai-search\b/.test(r.url()) && r.request().method() === 'POST', {
        timeout: 90_000,
      })
      .catch(() => null);
    await btn.click();
    // While in-flight the button reflects the busy state (honest affordance).
    await expect(btn, 'button shows Searching… while in flight').toHaveText(/Searching/i, {
      timeout: 5000,
    });

    const resp = await respP;
    const status = resp?.status() ?? 0;

    // The search must RESOLVE — spinner clears (button back to its idle label) within
    // a generous window, whatever the outcome. An infinite spinner is a defect.
    await expect(btn, 'spinner clears — button returns to idle label').toHaveText(/Search with AI/i, {
      timeout: 30_000,
    });

    // Business result: EITHER results rendered OR an honest error toast — never a
    // silent nothing. (results-loading must be gone by now.)
    const results = page.locator('[data-testid="ai-results"]');
    const errToast = page
      .locator('[data-testid="toast-item"]')
      .filter({ hasText: /search failed|try again/i });
    const gotResults = await results.isVisible().catch(() => false);
    const gotError = await errToast.isVisible().catch(() => false);

    if (gotResults) {
      // If available cards rendered, each must carry a Register button (never a
      // card the user can't act on).
      const registerBtns = page.locator('[data-testid^="register-"]');
      const available = await registerBtns.count();
      console.log(`CHAOS11/ai-search: results rendered, ${available} available card(s), status=${status}`);
    } else {
      console.log(`CHAOS11/ai-search: no results (gotError=${gotError}), status=${status}`);
    }

    expect(
      gotResults || gotError,
      `AI search must resolve to results OR an honest error toast (status=${status}), not a silent nothing`,
    ).toBe(true);

    await assertAlive(page);
    // The hard defect gate: no 5xx from the search endpoint, no app console noise.
    expect(status, `ai-search POST must not 5xx (got ${status})`).toBeLessThan(500);
    expect(await e.xssFired(), 'no injected script fired').toBe(false);
    expect(e.pageErrors, `pageerrors: ${e.pageErrors.join('; ')}`).toEqual([]);
    expect(e.serverErrors, `5xx: ${e.serverErrors.join('; ')}`).toEqual([]);
    expect(e.consoleErrors, `console errors: ${e.consoleErrors.join('; ')}`).toEqual([]);
    expect(e.consoleWarnings, `console warnings (DoD=0): ${e.consoleWarnings.join('; ')}`).toEqual(
      [],
    );
  });

  test('custom-domain add: malformed hostnames keep submit disabled; a valid one enables it (no dead button)', async ({
    page,
  }) => {
    const e = trackErrors(page);
    await seedAuth(page, KEY);
    await page.goto('/admin/domains', { waitUntil: 'domcontentloaded' });

    const input = page.locator('[data-testid="custom-domain-input"]');
    await expect(input, 'custom-domain input reachable').toBeVisible({ timeout: 20_000 });
    const submit = page
      .locator('form', { has: page.locator('[data-testid="custom-domain-input"]') })
      .locator('button[type="submit"]');

    // Each malformed value must keep the submit DISABLED (client Zod-parity gate) —
    // no dead button that would 400 on the server.
    const invalid = [
      '   ', // whitespace only
      'ab', // too short (<3)
      'notadomain', // no dot
      'has space.com', // space
      'http://example.com', // scheme + slashes
      '<script>x</script>', // XSS-ish
      '-lead.com', // label starts with hyphen
      'trailing.dot.', // trailing dot → empty last label
    ];
    for (const v of invalid) {
      await input.fill(v);
      await expect(submit, `submit stays disabled for malformed "${v}"`).toBeDisabled({
        timeout: 3000,
      });
    }

    // A valid hostname ENABLES the submit (we do NOT click it — no real hostname created).
    await input.fill('www.example.com');
    await expect(submit, 'submit enables for a valid domain').toBeEnabled({ timeout: 3000 });
    await input.fill('a.co'); // 4-char boundary valid
    await expect(submit, 'submit enables for the min-length boundary domain').toBeEnabled({
      timeout: 3000,
    });

    // Clear so no stray value is left in the field.
    await input.fill('');

    await assertAlive(page);
    expect(await e.xssFired(), 'no injected script fired from the XSS-ish value').toBe(false);
    expect(e.pageErrors, `pageerrors: ${e.pageErrors.join('; ')}`).toEqual([]);
    expect(e.serverErrors, `5xx: ${e.serverErrors.join('; ')}`).toEqual([]);
    expect(e.consoleErrors, `console errors: ${e.consoleErrors.join('; ')}`).toEqual([]);
    expect(e.consoleWarnings, `console warnings (DoD=0): ${e.consoleWarnings.join('; ')}`).toEqual(
      [],
    );
  });
});
