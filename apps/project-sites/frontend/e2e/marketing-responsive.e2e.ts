/**
 * @module e2e/marketing-responsive
 *
 * Responsive a11y for the PUBLIC marketing pages — the whole-project counterpart
 * to admin-a11y-mobile + admin-reflow:
 *   - 390px: WCAG 2.2 axe (target-size, mobile layout)
 *   - 320px: WCAG 1.4.10 reflow (no real element overflows the viewport)
 *
 * Covers the marketing pages that are NOT concurrent-session-owned or
 * worker-served: blog / press / privacy / terms / roadmap / integrations.
 * (Excluded: / + /contact + /signin = concurrent-dirty homepage/signin files;
 * /status + /changelog = worker-served — see marketing-a11y.e2e.ts header.)
 *
 * Run: npx playwright test --config=playwright.prod.config.ts marketing-responsive
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// '/', '/contact', '/signin' joined once their a11y blocks cleared (see
// marketing-a11y.e2e.ts header). All verified reflow-clean @320px live.
const ROUTES = [
  '/', '/contact', '/signin',
  '/blog', '/press', '/privacy', '/terms', '/roadmap', '/integrations',
  // Coverage gap closed (round 33): these public funnel/legal pages had NO a11y
  // sweep — /search + /create each shipped a serious color-contrast violation
  // (text-gray-500 #6a7282 = 4.16:1 on the dark bg) that went uncaught. Fixed to
  // text-gray-400 (~7:1) and gated here so it can't regress.
  '/search', '/create', '/content',
];

test.describe('marketing — responsive a11y (390 axe + 320 reflow)', () => {
  test.describe.configure({ retries: 2 });

  test.describe('390px mobile axe', () => {
    test.use({ viewport: { width: 390, height: 844 } });
    for (const path of ROUTES) {
      test(`no serious/critical @390px — ${path}`, async ({ page }) => {
        test.setTimeout(60000);
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.goto(path, { waitUntil: 'load' });
        await expect(page.locator('main, header, body').first()).toBeVisible({ timeout: 30000 });
        await page.waitForTimeout(700);
        const results = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
          .exclude('iframe').exclude('.ag-root').analyze();
        const blocking = results.violations
          .filter((v) => v.impact === 'serious' || v.impact === 'critical')
          .map((v) => `${v.impact} · ${v.id} · ${v.nodes.length}× · ${v.nodes[0]?.target?.join(' ') ?? ''}`);
        expect(blocking, `${path} @390px\n${blocking.join('\n')}`).toEqual([]);
      });
    }
  });

  // 320px floor + 390px (most common phone) — 390 catches mid-breakpoint
  // overflow that 320 misses (a flex-wrap row that wraps at 320 but overflows
  // at 390), the class that hit the /admin top-bar (see admin-reflow).
  for (const VW of [320, 390]) {
  test.describe(`${VW}px reflow`, () => {
    test.use({ viewport: { width: VW, height: 800 } });
    for (const path of ROUTES) {
      test(`no element overflows @${VW}px — ${path}`, async ({ page }) => {
        test.setTimeout(60000);
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.goto(path, { waitUntil: 'load' });
        await expect(page.locator('main, header, body').first()).toBeVisible({ timeout: 30000 });
        await page.addStyleTag({ content: 'html{scrollbar-width:none!important}::-webkit-scrollbar{display:none!important}' });
        await page.waitForTimeout(1400);
        // Real overflow only: not position fixed/sticky, not clipped by an ancestor.
        const culprits = await page.evaluate(() => {
          const vw = window.innerWidth;
          const clipped = (el: Element): boolean => {
            let n = el.parentElement;
            while (n && n !== document.body) {
              const s = getComputedStyle(n);
              if (['hidden', 'clip', 'auto', 'scroll'].includes(s.overflowX)) return true;
              if (['fixed', 'sticky'].includes(s.position)) return true;
              n = n.parentElement;
            }
            return false;
          };
          const found: string[] = [];
          for (const el of Array.from(document.body.querySelectorAll<HTMLElement>('*'))) {
            const s = getComputedStyle(el);
            if (s.position === 'fixed' || s.position === 'sticky') continue;
            const r = el.getBoundingClientRect();
            if (r.right > vw + 4 && r.width > 1 && !clipped(el)) {
              found.push(`${el.tagName.toLowerCase()}.${(el.className || '').toString().split(' ').slice(0, 2).join('.')} (right=${Math.round(r.right)})`);
            }
          }
          return found.slice(0, 5);
        });
        expect(culprits, `${path} overflows @${VW}px:\n${culprits.join('\n')}`).toEqual([]);
      });
    }
  });
  }
});

test.describe('marketing — integrations logos resolve (no dead clearbit API)', () => {
  test.describe.configure({ retries: 2 });
  test.use({ viewport: { width: 1280, height: 900 } });

  // Regression: the integrations grid sourced logos from logo.clearbit.com,
  // whose free API HubSpot shut down (Dec 2024) → ERR_NAME_NOT_RESOLVED on every
  // load + broken images. The component now rewrites them to a reliable source
  // (Google favicons) before render. Guard that no dead clearbit URL returns and
  // the logos actually load.
  test('every integration logo loads from a live source — no clearbit, no broken images', async ({ page }) => {
    test.setTimeout(60000);
    const failedLogos: string[] = [];
    page.on('requestfailed', (r) => {
      if (/logo\.clearbit\.com/.test(r.url())) failedLogos.push(r.url());
    });
    await page.goto('/integrations', { waitUntil: 'load' });
    await expect(page.locator('main, body').first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2500);
    const stats = await page.evaluate(() => {
      const imgs = Array.from(document.querySelectorAll<HTMLImageElement>('.logo-tile img'));
      return {
        total: imgs.length,
        clearbit: imgs.filter((i) => i.src.includes('clearbit')).length,
        loaded: imgs.filter((i) => i.complete && i.naturalWidth > 0).length,
      };
    });
    expect(stats.total, 'integration logo tiles render').toBeGreaterThan(10);
    expect(stats.clearbit, 'no dead clearbit logo URLs in the DOM').toBe(0);
    expect(failedLogos, `clearbit requests still firing:\n${failedLogos.join('\n')}`).toEqual([]);
    expect(stats.loaded, 'the large majority of logos load (naturalWidth>0)').toBeGreaterThan(stats.total * 0.8);
  });
});

test.describe('marketing — OG image within budget', () => {
  test.describe.configure({ retries: 2 });

  // Regression: the shared OG card (og-image.jpg) must stay 1200×630 AND
  // <= 100KB per the asset budget (it was a 235KB PNG; re-encoded to a ~95KB
  // mozjpeg q90). Social cards balloon silently when someone drops in a new PNG.
  test('og-image.jpg is served, image/jpeg, and <= 100KB', async ({ page }) => {
    test.setTimeout(30000);
    const res = await page.request.get('https://projectsites.dev/og-image.jpg', { failOnStatusCode: false });
    expect(res.status(), 'og-image.jpg resolves').toBe(200);
    expect(res.headers()['content-type'] ?? '', 'served as JPEG').toContain('image/jpeg');
    const bytes = (await res.body()).length;
    expect(bytes, `og-image.jpg is ${Math.round(bytes / 1024)}KB — must be <= 100KB`).toBeLessThanOrEqual(100 * 1024);
  });

  test('homepage og:image points to the .jpg card', async ({ page }) => {
    test.setTimeout(30000);
    await page.goto('/', { waitUntil: 'load' });
    const og = await page.locator('meta[property="og:image"]').first().getAttribute('content');
    expect(og ?? '', 'og:image uses the .jpg card').toContain('og-image.jpg');
  });
});

test.describe('marketing — required favicon files serve real images', () => {
  test.describe.configure({ retries: 2 });

  // Regression: favicon-16x16.png / favicon-32x32.png (always.md required-file
  // names + what SEO/favicon tools probe) were absent, so the worker served its
  // 156-byte JSON catch-all with HTTP 200 + content-type application/json — a
  // favicon that's actually JSON. Now provided as real PNGs in public/.
  for (const f of ['favicon-16x16.png', 'favicon-32x32.png', 'favicon.ico']) {
    test(`/${f} is a real image, not the JSON fallback`, async ({ page }) => {
      test.setTimeout(20000);
      const res = await page.request.get(`https://projectsites.dev/${f}`, { failOnStatusCode: false });
      expect(res.status(), `${f} resolves`).toBe(200);
      const ct = res.headers()['content-type'] ?? '';
      expect(ct, `${f} served as an image (not JSON), got: ${ct}`).toMatch(/^image\//);
    });
  }
});

test.describe('marketing — 404 soft-not-found is noindex + titled', () => {
  test.describe.configure({ retries: 2 });
  test.use({ viewport: { width: 1280, height: 900 } });

  // Regression: unknown routes hit the SPA wildcard → NotFoundComponent, served
  // HTTP 200 (soft-404). It previously kept the homepage <title> and the
  // index.html `robots: index, follow` — so Google could index junk URLs. The
  // component now sets a 404 title + `noindex, follow` on mount (restored on
  // SPA nav-away). Guard both, plus that the 404 actually renders its h1.
  test('unknown route renders a real 404 with noindex robots + 404 title', async ({ page }) => {
    test.setTimeout(45000);
    await page.goto('/this-route-does-not-exist-xyz', { waitUntil: 'load' });
    await expect(page.locator('app-not-found h1')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('app-not-found h1')).toHaveText(/doesn.t exist/i);
    const robots = await page.locator('meta[name="robots"]').first().getAttribute('content');
    expect(robots ?? '', '404 must be noindex so junk URLs are not indexed').toContain('noindex');
    expect(await page.title(), '404 sets its own title, not the homepage title').toMatch(/not found|404/i);
  });

  test('navigating away from 404 restores indexable robots', async ({ page }) => {
    test.setTimeout(45000);
    await page.goto('/this-route-does-not-exist-xyz', { waitUntil: 'load' });
    await expect(page.locator('app-not-found h1')).toBeVisible({ timeout: 30000 });
    // SPA nav back to a real, indexable route via the 404 page's home link.
    await page.locator('app-not-found a[href="/"], app-not-found a[routerlink="/"]').first().click();
    await expect(page.locator('app-not-found')).toHaveCount(0, { timeout: 15000 });
    await page.waitForTimeout(500);
    const robots = await page.locator('meta[name="robots"]').first().getAttribute('content');
    expect(robots ?? '', 'real routes must stay indexable after leaving the 404').toContain('index');
    expect(robots ?? '').not.toContain('noindex');
  });
});

test.describe('marketing — /waiting build-progress a11y (stateful)', () => {
  test.describe.configure({ retries: 2 });

  // /waiting redirects to / without funnel state, so it can't go in the bare
  // ROUTES sweep — it needs ?id=&slug= query params to render. Its slug + status
  // text shipped text-gray-500 (#6a7282 = 4.16:1 on the dark bg, below AA);
  // fixed to text-gray-400 (~7:1) round 33/34. Gate it with state so it can't
  // regress.
  const WAITING = '/waiting?id=test-id&slug=test-site';

  test('no serious/critical axe @390px — /waiting', async ({ page }) => {
    test.setTimeout(45000);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(WAITING, { waitUntil: 'load' });
    await expect(page).toHaveURL(/\/waiting/, { timeout: 15000 });
    await page.waitForTimeout(800);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .exclude('iframe')
      .analyze();
    const blocking = results.violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${v.impact} · ${v.id} · ${v.nodes.length}×`);
    expect(blocking, `/waiting @390px\n${blocking.join('\n')}`).toEqual([]);
  });

  test('no element overflows @320px — /waiting', async ({ page }) => {
    test.setTimeout(45000);
    await page.setViewportSize({ width: 320, height: 800 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(WAITING, { waitUntil: 'load' });
    await expect(page).toHaveURL(/\/waiting/, { timeout: 15000 });
    await page.addStyleTag({ content: 'html{scrollbar-width:none!important}::-webkit-scrollbar{display:none!important}' });
    await page.waitForTimeout(1000);
    const culprits = await page.evaluate(() => {
      const vw = window.innerWidth;
      const clipped = (el: Element): boolean => {
        let n = el.parentElement;
        while (n && n !== document.body) {
          const s = getComputedStyle(n);
          if (['hidden', 'clip', 'auto', 'scroll'].includes(s.overflowX)) return true;
          if (['fixed', 'sticky'].includes(s.position)) return true;
          n = n.parentElement;
        }
        return false;
      };
      const found: string[] = [];
      for (const el of Array.from(document.body.querySelectorAll<HTMLElement>('*'))) {
        const s = getComputedStyle(el);
        if (s.position === 'fixed' || s.position === 'sticky') continue;
        const r = el.getBoundingClientRect();
        if (r.right > vw + 4 && r.width > 1 && !clipped(el)) {
          found.push(`${el.tagName.toLowerCase()}.${(el.className || '').toString().split(' ').slice(0, 2).join('.')}`);
        }
      }
      return found.slice(0, 5);
    });
    expect(culprits, `/waiting overflows @320px:\n${culprits.join('\n')}`).toEqual([]);
  });
});

test.describe('marketing — /press brand kit downloads (no dead /brand link)', () => {
  test.describe.configure({ retries: 2 });
  test.use({ viewport: { width: 1280, height: 900 } });

  // Regression: /press promised a "Download brand kit (4 MB)" at routerLink="/brand"
  // and a text "grab the ZIP at /brand" — but no /brand route OR ZIP existed, so
  // both links 404'd (app-not-found). Now a real public/brand-kit.zip (logos +
  // BRAND_GUIDELINES.txt) exists and both links point to it via download href.
  test('brand kit link resolves to a real downloadable ZIP, no /brand 404', async ({ page }) => {
    test.setTimeout(45000);
    await page.goto('/press', { waitUntil: 'load' });
    await expect(page.locator('.cta-primary')).toBeVisible({ timeout: 30000 });
    // No link points to the dead /brand route.
    const deadBrand = await page.locator('a[href="/brand"], a[routerlink="/brand"]').count();
    expect(deadBrand, 'no link to the non-existent /brand route').toBe(0);
    // The download CTA points at the real asset.
    await expect(page.locator('.cta-primary')).toHaveAttribute('href', '/brand-kit.zip');
    // And the asset actually serves.
    const res = await page.request.get('https://projectsites.dev/brand-kit.zip', { failOnStatusCode: false });
    expect(res.status(), 'brand-kit.zip resolves').toBe(200);
    expect((await res.body()).length, 'brand-kit.zip is non-empty').toBeGreaterThan(1000);
  });
});

test.describe('marketing — exactly one H1 per public route', () => {
  test.describe.configure({ retries: 2 });
  test.use({ viewport: { width: 1280, height: 900 } });

  // always.md: exactly 1 H1 per page (SEO + a11y page-has-heading-one). axe flags
  // this as "moderate", so the serious/critical sweeps miss it — /signin shipped
  // with H1=0 (top heading was <h2>Welcome</h2>) until round 39. This gate guards
  // every public route. NOTE: the homepage hero h1 hydrates late (behavioral
  // swap), so we wait for the h1 to appear before counting.
  for (const path of ROUTES) {
    test(`exactly one <h1> — ${path}`, async ({ page }) => {
      test.setTimeout(45000);
      await page.goto(path, { waitUntil: 'load' });
      // Wait for at least one h1 to hydrate (homepage swaps its hero h1 ~3s in).
      await page.waitForFunction(() => document.querySelectorAll('h1').length >= 1, { timeout: 15000 })
        .catch(() => {});
      const count = await page.locator('h1').count();
      const texts = await page.locator('h1').allTextContents();
      expect(count, `${path} must have exactly one <h1>, found ${count}: ${JSON.stringify(texts)}`).toBe(1);
    });
  }
});

test.describe('marketing — no fabricated AggregateRating in JSON-LD', () => {
  test.describe.configure({ retries: 2 });
  test.use({ viewport: { width: 1280, height: 900 } });

  // Regression: the homepage SoftwareApplication JSON-LD shipped a hardcoded
  // AggregateRating (4.9 / 47 reviews) with ZERO real reviews + no on-page
  // review content — a fabricated authority signal (banned by
  // thin-source-amplification + a Google structured-data policy violation:
  // ratings must reflect real, visible reviews). Removed from both sources
  // (src/index.html static block + lib/json-ld.ts softwareApplication factory).
  // Guard that no public route re-introduces an AggregateRating until genuine,
  // on-page reviews exist.
  for (const path of ['/', '/press', '/blog']) {
    test(`no AggregateRating JSON-LD — ${path}`, async ({ page }) => {
      test.setTimeout(30000);
      await page.goto(path, { waitUntil: 'load' });
      await page.waitForTimeout(1200);
      const hasRating = await page.evaluate(() => {
        let found = false;
        const walk = (o: unknown): void => {
          if (!o || typeof o !== 'object') return;
          if (Array.isArray(o)) { o.forEach(walk); return; }
          const rec = o as Record<string, unknown>;
          if (rec['@type'] === 'AggregateRating') found = true;
          Object.values(rec).forEach(walk);
        };
        document.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
          try { walk(JSON.parse(s.textContent || '')); } catch { /* ignore */ }
        });
        return found;
      });
      expect(hasRating, `${path} must not ship a fabricated AggregateRating (no real reviews exist)`).toBe(false);
    });
  }
});
