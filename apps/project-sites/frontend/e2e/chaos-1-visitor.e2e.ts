/**
 * CHAOS 1 — "The Skeptical Visitor": public marketing + search resilience.
 *
 * Homepage-first. Feeds the business/site search hostile inputs (XSS, SQLi-ish,
 * 6000-char, unicode/null, path-traversal, rapid-fire), walks every nav/footer
 * link, hammers a garbage URL, and spams back/forward — asserting the site never
 * crashes, white-screens, executes injected script, or 5xx's.
 */
import { test, expect } from '@playwright/test';
import { trackErrors, assertAlive, EVIL_LIST } from './chaos-helpers';

test.describe('CHAOS 1 — Skeptical Visitor (marketing + search)', () => {
  test('homepage shell renders, no XSS, no 5xx, no app errors', async ({ page }) => {
    const e = trackErrors(page);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 20_000 });
    await assertAlive(page);
    await page.waitForTimeout(2500); // let deferred/async errors surface

    // Report the console baseline (visible in the runner output for calibration).
    console.log('CHAOS1/home console:', JSON.stringify(e.consoleErrors));
    console.log('CHAOS1/home pageerr:', JSON.stringify(e.pageErrors));
    console.log('CHAOS1/home failed :', JSON.stringify(e.failedRequests));
    console.log('CHAOS1/home 404ast :', JSON.stringify(e.notFoundAssets));
    console.log('CHAOS1/home 5xx    :', JSON.stringify(e.serverErrors));

    expect(await e.xssFired(), 'no injected script executed on load').toBe(false);
    expect(e.serverErrors, `5xx: ${e.serverErrors.join('; ')}`).toEqual([]);
    expect(e.pageErrors, `pageerrors: ${e.pageErrors.join('; ')}`).toEqual([]);
    expect(e.consoleErrors, `console errors: ${e.consoleErrors.join('; ')}`).toEqual([]);
    expect(e.consoleWarnings, `console warnings (DoD=0): ${e.consoleWarnings.join('; ')}`).toEqual(
      [],
    );
    expect(
      e.notFoundAssets,
      `missing same-origin assets (404): ${e.notFoundAssets.join('; ')}`,
    ).toEqual([]);
  });

  test('business search survives hostile inputs (honest degradation, no XSS/crash)', async ({
    page,
  }) => {
    const e = trackErrors(page);
    await page.goto('/');
    const search = page
      .locator(
        'input[type="search"], input[placeholder*="business" i], input[placeholder*="search" i], input[placeholder*="name" i]',
      )
      .first();
    await expect(search).toBeVisible({ timeout: 20_000 });

    for (const evil of EVIL_LIST) {
      await search.fill(evil);
      await page.waitForTimeout(500); // debounce window
      await assertAlive(page); // never white-screen mid-typing
    }
    await page.waitForTimeout(1500);

    console.log('CHAOS1/search console:', JSON.stringify(e.consoleErrors));
    console.log('CHAOS1/search 5xx    :', JSON.stringify(e.serverErrors));
    expect(await e.xssFired(), 'search did not execute injected script').toBe(false);
    expect(e.serverErrors, `5xx: ${e.serverErrors.join('; ')}`).toEqual([]);
    expect(e.pageErrors, `pageerrors: ${e.pageErrors.join('; ')}`).toEqual([]);
  });

  test('garbage URL → real 404 status + styled (not blank) 404 page', async ({ page }) => {
    const resp = await page.goto('/this-route-absolutely-does-not-exist-9xz');
    expect(resp?.status(), 'unknown HTML path must be a real 404, not a soft-200').toBe(404);
    await assertAlive(page); // 404 page is styled, not blank
  });

  test('bogus /api path returns clean JSON 404, never the SPA shell', async ({ request }) => {
    const r = await request.get('https://projectsites.dev/api/this-endpoint-does-not-exist');
    expect(r.status(), 'unmatched /api/* must 404, not 200').toBe(404);
    const ct = r.headers()['content-type'] ?? '';
    expect(ct, `/api 404 should be JSON not HTML shell — got ${ct}`).toContain('json');
  });

  test('nav + footer internal links: none 5xx', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1500);
    const hrefs: string[] = await page.evaluate(() =>
      Array.from(document.querySelectorAll('a[href]'))
        .map((a) => (a as HTMLAnchorElement).getAttribute('href') || '')
        .filter((h) => h.startsWith('/') && !h.startsWith('//')),
    );
    const unique = [...new Set(hrefs)].slice(0, 30);
    console.log('CHAOS1/links:', JSON.stringify(unique));
    const broken: string[] = [];
    for (const h of unique) {
      const r = await page.request.get(new URL(h, 'https://projectsites.dev').toString());
      if (r.status() >= 500) broken.push(`${h} → ${r.status()}`);
    }
    expect(broken, `5xx internal links: ${broken.join('; ')}`).toEqual([]);
  });

  test('back/forward spam after searching leaves the shell alive', async ({ page }) => {
    await page.goto('/');
    await page.goto('/create').catch(() => {});
    for (let i = 0; i < 4; i++) {
      await page.goBack().catch(() => {});
      await page.goForward().catch(() => {});
    }
    await assertAlive(page);
  });
});
