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

  test('nav + footer internal links hydrate (≥4) and none 4xx/5xx', async ({ page }) => {
    await page.goto('/');
    // The nav/footer anchors hydrate AFTER the SPA boots. A bare `waitForTimeout`
    // collected `[]` (links not yet in the DOM) and the 5xx assertion passed
    // VACUOUSLY — a stub that proved nothing. Wait for the anchors to actually
    // exist, then require a real minimum count so this can never pass empty again.
    // (chaos convergence pass 2026-08-16.)
    await page
      .waitForFunction(
        () => document.querySelectorAll('a[href^="/"]:not([href^="//"])').length >= 4,
        { timeout: 15_000 },
      )
      .catch(() => {});
    const hrefs: string[] = await page.evaluate(() =>
      Array.from(document.querySelectorAll('a[href]'))
        .map((a) => (a as HTMLAnchorElement).getAttribute('href') || '')
        .filter((h) => h.startsWith('/') && !h.startsWith('//')),
    );
    const unique = [...new Set(hrefs)].slice(0, 30);
    console.log('CHAOS1/links:', JSON.stringify(unique));
    // The real nav+footer links (/developers, /blog, /privacy, /terms, /content …)
    // MUST be present — an empty set means the shell never hydrated its chrome.
    expect(
      unique.length,
      `homepage internal links did not hydrate: ${JSON.stringify(unique)}`,
    ).toBeGreaterThanOrEqual(4);
    // A KNOWN nav/footer route that 4xx's is a broken link (not just a 5xx crash).
    const broken: string[] = [];
    for (const h of unique) {
      const r = await page.request.get(new URL(h, 'https://projectsites.dev').toString());
      if (r.status() >= 400) broken.push(`${h} → ${r.status()}`);
    }
    expect(broken, `broken internal links (4xx/5xx): ${broken.join('; ')}`).toEqual([]);
  });

  test('M1: every homepage nav control responds with its real business result', async ({
    page,
  }) => {
    // "Press EVERY meaningful button + ASSERT the business result" for the M1
    // zero-to-value entry. The primary nav is BUTTON-based (scroll/route/lang
    // actions), which the link crawl above can't reach — so drive each one and
    // assert what it actually does, not merely that it renders.
    const e = trackErrors(page);
    await page.goto('/');
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 20_000 });

    // 1) Section-scroll CTAs (Features / Pricing / FAQ) must scroll the page.
    for (const label of ['Features', 'Pricing', 'FAQ']) {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(200);
      const btn = page.getByRole('button', { name: new RegExp(`^${label}$`, 'i') }).first();
      if (await btn.count()) {
        await btn.click().catch(() => {});
        await page.waitForTimeout(700);
        const y = await page.evaluate(() => window.scrollY);
        expect(y, `nav "${label}" did not scroll to its section`).toBeGreaterThan(50);
      }
    }

    // 2) "Get Started" (primary conversion CTA) must start the funnel — it focuses
    //    the hero business-search input (zero-to-value entry point).
    await page.evaluate(() => window.scrollTo(0, 0));
    const getStarted = page.getByRole('button', { name: /get started/i }).first();
    if (await getStarted.count()) {
      await getStarted.click().catch(() => {});
      await page.waitForTimeout(600);
      const focusedSearch = await page.evaluate(() => {
        const a = document.activeElement as HTMLInputElement | null;
        return (
          !!a &&
          a.tagName === 'INPUT' &&
          /business|search/i.test(a.getAttribute('placeholder') || '')
        );
      });
      expect(focusedSearch, '"Get Started" did not focus the hero search (dead CTA)').toBe(true);
    }

    // 3) "Sign In" must route to the sign-in surface.
    await page
      .getByRole('button', { name: /^sign in$/i })
      .first()
      .click()
      .catch(() => {});
    await page.waitForTimeout(800);
    expect(page.url(), '"Sign In" did not route to /signin').toContain('/signin');

    // 4) Language toggle (ES) must actually switch <html lang>.
    await page.goto('/');
    await page.waitForTimeout(1200);
    const es = page.getByRole('button', { name: /^es$/i }).first();
    if (await es.count()) {
      await es.click().catch(() => {});
      await page.waitForTimeout(800);
      const lang = await page.evaluate(() => document.documentElement.lang);
      expect(lang, 'ES toggle did not switch <html lang> to es').toBe('es');
    }

    expect(e.pageErrors, `pageerrors: ${e.pageErrors.join('; ')}`).toEqual([]);
    expect(e.serverErrors, `5xx: ${e.serverErrors.join('; ')}`).toEqual([]);
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

  // M1 — the served-site "Wow → Own → Buy" conversion funnel (the promotional bar
  // injected into EVERY free published site by `site_serving.generateConversionFlow`).
  // Its two revenue-critical seams are cross-origin fetches from `{slug}.projectsites.dev`
  // to the apex: `GET /api/domains/availability` (the Claim-modal domain search) and
  // `POST /api/conversion/checkout` (the "Get Started — $50/mo" Stripe redirect). Render
  // sweeps never exercise these — a dead/challenged endpoint would silently break checkout
  // for every free-site visitor (the funnel's `.catch` shows "Connection error"). MUST run
  // the fetches IN THE PAGE CONTEXT (`page.evaluate`), not `page.request` — a real visitor
  // carries a zone-wide `cf_clearance` cookie from the served-page load that passes the WAF;
  // a fresh request context (like curl) is managed-challenged and would false-fail.
  test('M1: served-site conversion funnel endpoints return real business results (domain list + Stripe checkout url)', async ({
    page,
  }) => {
    // Land on a real served site so the browser holds the *.projectsites.dev clearance a
    // real visitor would (the funnel's fetches go cross-origin to the apex from here).
    const landed = await page
      .goto('https://megabytespace.projectsites.dev/', { waitUntil: 'domcontentloaded' })
      .then((r) => r?.status() ?? 0)
      .catch(() => 0);
    test.skip(landed !== 200, `served site not reachable (HTTP ${landed}) — environmental`);

    const result = (await page.evaluate(async () => {
      let domains, domainsErr, checkout, checkoutErr;
      // 1) Domain search — the Claim modal's `#ps-dinput` calls this on input.
      try {
        const r = await fetch('https://projectsites.dev/api/domains/availability?name=probebiz', {
          headers: { Accept: 'application/json' },
        });
        const j = await r.json().catch(() => null);
        domains = { status: r.status, list: Array.isArray(j?.data) ? j.data : null };
      } catch (e) {
        domainsErr = String(e);
      }
      // 2) Checkout — `#ps-go-btn` posts this; a valid `checkout_url` is THE business
      //    result (redirects the visitor to Stripe). Creates an abandoned session only.
      try {
        const r = await fetch('https://projectsites.dev/api/conversion/checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug: 'megabytespace', domain: null }),
        });
        const j = await r.json().catch(() => null);
        checkout = { status: r.status, url: j?.data?.checkout_url ?? null };
      } catch (e) {
        checkoutErr = String(e);
      }
      return { domains, domainsErr, checkout, checkoutErr };
    })) as {
      domains?: { status: number; list: { domain: string; available: boolean }[] | null };
      domainsErr?: string;
      checkout?: { status: number; url: string | null };
      checkoutErr?: string;
    };
    console.log('CHAOS1/funnel:', JSON.stringify(result));

    // Domain search: 200 + a real availability list (each entry a {domain, available}).
    expect(result.domainsErr, `domain search threw: ${result.domainsErr}`).toBeUndefined();
    expect(
      result.domains?.status,
      'GET /api/domains/availability must be 200 (live, not challenged)',
    ).toBe(200);
    expect(
      result.domains?.list?.length ?? 0,
      'domain search returned no candidates (funnel modal would show empty)',
    ).toBeGreaterThan(0);
    expect(
      result.domains?.list?.every(
        (d) => typeof d.domain === 'string' && typeof d.available === 'boolean',
      ),
      'domain candidates missing {domain, available} shape',
    ).toBe(true);

    // Checkout: 200 + a Stripe checkout URL (the redirect target — proves the revenue
    // path is live end-to-end, not a dead "Get Started" button).
    expect(result.checkoutErr, `checkout threw: ${result.checkoutErr}`).toBeUndefined();
    expect(
      result.checkout?.status,
      'POST /api/conversion/checkout must be 200 (live, not challenged)',
    ).toBe(200);
    expect(
      result.checkout?.url ?? '',
      `checkout did not return a Stripe url (dead revenue path): ${result.checkout?.url}`,
    ).toMatch(/^https:\/\/checkout\.stripe\.com\//);
  });
});
