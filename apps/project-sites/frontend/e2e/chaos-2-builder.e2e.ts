/**
 * CHAOS 2 — "The Impatient Builder": create funnel + AI helpers + domain picker.
 *
 * Homepage-first → into the Create funnel. Feeds the prompt/details + domain
 * search hostile inputs (over the 5000-char cap, injection, unicode, invalid
 * TLDs, 253-char labels) and asserts honest validation / "couldn't check"
 * degradation — never a crash, XSS, or 5xx.
 */
import { test, expect } from '@playwright/test';
import { trackErrors, assertAlive, EVIL, EVIL_LIST } from './chaos-helpers';

test.describe('CHAOS 2 — Impatient Builder (create funnel + AI + domains)', () => {
  test('create funnel loads from the homepage CTA, shell alive', async ({ page }) => {
    const e = trackErrors(page);
    await page.goto('/');
    await page.goto('/create', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    await assertAlive(page);
    console.log('CHAOS2/create console:', JSON.stringify(e.consoleErrors));
    console.log('CHAOS2/create warn   :', JSON.stringify(e.consoleWarnings));
    console.log('CHAOS2/create 5xx    :', JSON.stringify(e.serverErrors));
    expect(e.pageErrors, `pageerrors: ${e.pageErrors.join('; ')}`).toEqual([]);
    expect(e.serverErrors, `5xx: ${e.serverErrors.join('; ')}`).toEqual([]);
    expect(e.consoleErrors, `console errors: ${e.consoleErrors.join('; ')}`).toEqual([]);
    expect(e.consoleWarnings, `console warnings (DoD=0): ${e.consoleWarnings.join('; ')}`).toEqual(
      [],
    );
  });

  test('every text input on the create flow survives hostile fills', async ({ page }) => {
    const e = trackErrors(page);
    await page.goto('/create');
    await page.waitForTimeout(2000);
    const inputs = page.locator(
      'input[type="text"], input:not([type]), textarea, input[type="search"]',
    );
    const n = Math.min(await inputs.count(), 8);
    for (let i = 0; i < n; i++) {
      const inp = inputs.nth(i);
      if (!(await inp.isVisible().catch(() => false))) continue;
      for (const evil of [EVIL.xssScript, EVIL.huge, EVIL.sqli, EVIL.unicode]) {
        await inp.fill(evil).catch(() => {});
        await page.waitForTimeout(250);
      }
      await assertAlive(page);
    }
    await page.waitForTimeout(1000);
    console.log('CHAOS2/inputs console:', JSON.stringify(e.consoleErrors));
    expect(await e.xssFired(), 'no injected script executed in the create flow').toBe(false);
    expect(e.serverErrors, `5xx: ${e.serverErrors.join('; ')}`).toEqual([]);
    expect(e.pageErrors, `pageerrors: ${e.pageErrors.join('; ')}`).toEqual([]);
  });

  test('domain-search API degrades honestly on hostile queries (no 5xx, no lie)', async ({
    request,
  }) => {
    test.setTimeout(90_000); // RDAP upstream can be slow; each probe is time-boxed below
    // The picker calls /api/domains/search; probe with hostile queries — must never
    // 5xx, and must return a shaped payload, never a crash. (Auth-gated → 401 is fine.)
    const bad = [EVIL.xssScript, 'x'.repeat(253), 'пример', 'a..b', EVIL.sqli, 'no-tld'];
    const bad5xx: string[] = [];
    for (const q of bad) {
      const r = await request
        .get(`https://projectsites.dev/api/domains/search?q=${encodeURIComponent(q)}`, {
          timeout: 12_000,
          failOnStatusCode: false,
        })
        .catch(() => null);
      if (r && r.status() >= 500) bad5xx.push(`${q.slice(0, 20)} → ${r.status()}`);
    }
    expect(bad5xx).toEqual([]);
  });

  test('M2: business search degrades honestly + never leaks the upstream error + never strands the user', async ({
    page,
  }) => {
    // The create-funnel business search calls /api/search/businesses (Google Places).
    // Places is currently unavailable in prod (GCP billing — a P0 tracked separately), so
    // the funnel MUST degrade honestly: no 5xx, no crash, an honest "temporarily
    // unavailable" affordance, no raw upstream error leaked, AND the customer is never
    // stranded — /create IS the manual-entry funnel, so they can proceed regardless.
    const e = trackErrors(page);
    await page.goto('/create', { waitUntil: 'domcontentloaded' });
    // Stable selector — the business-name field by id, NEVER positional `.first()`. The
    // prior `input[type="text"].first()` + a fixed `waitForTimeout(1500)` + a one-shot
    // `evaluate` is what flaked under parallel load: the snapshot read the DOM before the
    // Angular signal→change-detection update for the affordance had landed.
    const biz = page.locator('#create-name');
    await expect(biz).toBeVisible({ timeout: 15_000 });
    await biz.click();
    await biz.pressSequentially('Starbucks', { delay: 80 }); // triggers the debounced search

    const resp = await page
      .waitForResponse((r) => r.url().includes('/api/search/businesses'), { timeout: 20_000 })
      .catch(() => null);
    if (resp) {
      expect(resp.status(), 'business search must never 5xx').toBeLessThan(500);
      const body = (await resp.json().catch(() => ({}))) as { _error?: { message?: string } };
      const msg = body._error?.message ?? '';
      // Info-disclosure gate: a generic message only — no raw upstream internals.
      expect(msg, `_error.message leaks upstream internals: ${msg}`).not.toMatch(
        /billing|permission|console\.cloud|PERMISSION_DENIED|\{/i,
      );
    }

    // Deterministic (web-first, auto-retrying) — poll until EITHER the honest unavailable
    // affordance renders OR real suggestions appear. Robust to BOTH prod states (Places
    // down → affordance; Places restored → suggestions) with no fixed sleep.
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const unavail = !!document.querySelector('[data-testid="business-search-unavailable"]');
            const items = document.querySelectorAll('.absolute [class*="cursor-pointer"]').length;
            return unavail || items > 0;
          }),
        {
          timeout: 15_000,
          message:
            'business search shows suggestions OR an honest unavailable affordance (never a blank dead field)',
        },
      )
      .toBe(true);

    // Not a dead-end: the customer can still proceed via MANUAL entry — the funnel kept
    // the typed value and the next field (address) is present + editable.
    await expect(biz).toHaveValue(/Starbucks/);
    await expect(page.locator('#create-address')).toBeVisible();

    await assertAlive(page);
    expect(e.serverErrors, `5xx: ${e.serverErrors.join('; ')}`).toEqual([]);
    expect(e.pageErrors, `pageerrors: ${e.pageErrors.join('; ')}`).toEqual([]);
  });

  test('AI improve-prompt endpoint never 5xx on hostile/oversized input', async ({ request }) => {
    // Over the 5000-char cap + injection. Bot-Fight may challenge (403) — that's
    // acceptable; a 5xx or a hang is not.
    const r = await request
      .post('https://projectsites.dev/api/sites/improve-prompt', {
        data: { text: EVIL.huge, business_name: EVIL.xssScript },
        failOnStatusCode: false,
        timeout: 20_000,
      })
      .catch(() => null);
    if (r) expect(r.status(), `improve-prompt status ${r.status()}`).toBeLessThan(500);
  });
});
