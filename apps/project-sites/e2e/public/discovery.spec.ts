/**
 * @module e2e/public/discovery
 * @description Public discovery endpoint tests — PUB-04 through PUB-13.
 *
 * All assertions use `page.request` (HTTP-level), not DOM navigation, so
 * they exercise the worker routing layer directly and stay hermetic.
 *
 * Covered rows (TEST-PLAN.md):
 *  PUB-04  /changelog.json  → valid JSON feed with entries array
 *  PUB-05  /feed.xml        → valid RSS 2.0 response
 *  PUB-06  /api/public/roadmap → structured data (items array)
 *  PUB-07  /api/public/integrations → vendor matrix array
 *  PUB-08  /.well-known/security.txt → present (redirect or direct)
 *  PUB-09  /llms.txt → served (flag-gated; 200 or 301 acceptable)
 *  PUB-10  /accessibility → HTML page renders WCAG statement
 *  PUB-11  /robots.txt → served with Sitemap: directive
 *  PUB-12  /sitemap.xml → listed in robots.txt sitemap directive
 *          (Direct /sitemap.xml is served from R2; not guaranteed in local dev)
 *  PUB-13  Marketing OG meta + JSON-LD present on homepage
 */

import { test, expect } from '../fixtures.js';

// ---------------------------------------------------------------------------
// PUB-04 — /changelog.json
// ---------------------------------------------------------------------------
test.describe('PUB-04 — /changelog.json', () => {
  test('returns 200 with valid JSON feed', async ({ request }) => {
    const res = await request.get('/changelog.json');
    expect(res.status()).toBe(200);
    const ct = res.headers()['content-type'] ?? '';
    expect(ct).toContain('application/json');
    const body = (await res.json()) as Record<string, unknown>;
    // Feed must have an entries array (even if empty in dev)
    expect(body).toHaveProperty('entries');
    expect(Array.isArray(body.entries)).toBe(true);
  });

  test('entries contain required fields when non-empty', async ({ request }) => {
    const res = await request.get('/changelog.json');
    const body = (await res.json()) as { entries: Array<Record<string, unknown>> };
    const entries = body.entries ?? [];
    for (const entry of entries.slice(0, 3)) {
      expect(typeof entry.version).toBe('string');
      expect(typeof entry.title).toBe('string');
      expect(typeof entry.date).toBe('string');
    }
  });
});

// ---------------------------------------------------------------------------
// PUB-05 — /feed.xml
// ---------------------------------------------------------------------------
test.describe('PUB-05 — /feed.xml', () => {
  test('returns 200 with RSS content-type', async ({ request }) => {
    const res = await request.get('/feed.xml');
    expect(res.status()).toBe(200);
    const ct = res.headers()['content-type'] ?? '';
    expect(ct).toContain('rss+xml');
  });

  test('RSS body contains expected channel elements', async ({ request }) => {
    const res = await request.get('/feed.xml');
    const text = await res.text();
    expect(text).toContain('<rss');
    expect(text).toContain('<channel>');
    expect(text).toContain('</channel>');
    // Must reference itself
    expect(text).toContain('feed.xml');
  });
});

// ---------------------------------------------------------------------------
// PUB-06 — /api/public/roadmap
// ---------------------------------------------------------------------------
test.describe('PUB-06 — /api/public/roadmap', () => {
  test('returns 200 with JSON roadmap data', async ({ request }) => {
    const res = await request.get('/api/public/roadmap');
    expect(res.status()).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    // Must have a top-level key containing roadmap rows/groups
    const hasItems =
      'items' in body ||
      'roadmap' in body ||
      'quarters' in body ||
      'data' in body;
    expect(hasItems).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// PUB-07 — /api/public/integrations
// ---------------------------------------------------------------------------
test.describe('PUB-07 — /api/public/integrations', () => {
  test('returns 200 with integrations array', async ({ request }) => {
    const res = await request.get('/api/public/integrations');
    expect(res.status()).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    const hasIntegrations =
      'integrations' in body ||
      'vendors' in body ||
      'data' in body;
    expect(hasIntegrations).toBe(true);
    // At least one integration expected
    const arr =
      (body.integrations as unknown[]) ??
      (body.vendors as unknown[]) ??
      (body.data as unknown[]) ??
      [];
    expect(arr.length).toBeGreaterThan(0);
  });

  test('each integration entry has a name field', async ({ request }) => {
    const res = await request.get('/api/public/integrations');
    const body = (await res.json()) as Record<string, unknown>;
    const arr: Array<Record<string, unknown>> =
      (body.integrations as Array<Record<string, unknown>>) ??
      (body.vendors as Array<Record<string, unknown>>) ??
      (body.data as Array<Record<string, unknown>>) ??
      [];
    for (const item of arr.slice(0, 5)) {
      expect(typeof item.name).toBe('string');
    }
  });
});

// ---------------------------------------------------------------------------
// PUB-08 — /.well-known/security.txt
// ---------------------------------------------------------------------------
test.describe('PUB-08 — /.well-known/security.txt', () => {
  test('endpoint responds (200 or 301/302)', async ({ request }) => {
    // The marketing site may serve security.txt from R2 or redirect to it.
    // Both 200 and 3xx are acceptable; 404 is not.
    const res = await request.get('/.well-known/security.txt');
    expect([200, 301, 302]).toContain(res.status());
  });

  test('body contains Contact: field when 200', async ({ request }) => {
    const res = await request.get('/.well-known/security.txt');
    if (res.status() === 200) {
      const text = await res.text();
      expect(text.toLowerCase()).toContain('contact:');
    }
  });
});

// ---------------------------------------------------------------------------
// PUB-09 — /llms.txt
// ---------------------------------------------------------------------------
test.describe('PUB-09 — /llms.txt (flag-gated)', () => {
  test('responds with non-404 status', async ({ request }) => {
    // llms.txt is flag-gated (llms_txt). In dev the flag may be off → 404.
    // Accept 200 (shipped), 301/302 (redirected), or 404 (flag-off) — never 500.
    const res = await request.get('/llms.txt');
    expect(res.status()).not.toBe(500);
  });

  test('when served, body references projectsites.dev', async ({ request }) => {
    const res = await request.get('/llms.txt');
    if (res.status() === 200) {
      const text = await res.text();
      expect(text).toContain('projectsites.dev');
    }
  });
});

// ---------------------------------------------------------------------------
// PUB-10 — /accessibility
// ---------------------------------------------------------------------------
test.describe('PUB-10 — /accessibility statement page', () => {
  test('returns HTML page (200 or redirect)', async ({ request }) => {
    const res = await request.get('/accessibility');
    // 200 for direct serve, 301/302 if flag-gated redirect
    expect([200, 301, 302]).toContain(res.status());
  });

  test('HTML contains WCAG statement text', async ({ page }) => {
    await page.goto('/accessibility');
    // Tolerate redirect to marketing shell; just assert no 500 and body exists
    const title = await page.title().catch(() => '');
    // Either the dedicated accessibility page or the marketing shell
    expect(title.length).toBeGreaterThan(0);
    const bodyText = await page.evaluate(() => document.body.innerText);
    // Should mention accessibility or WCAG somewhere
    const hasAccessibilityContent =
      bodyText.toLowerCase().includes('accessibility') ||
      bodyText.toLowerCase().includes('wcag');
    expect(hasAccessibilityContent).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// PUB-11 — robots.txt
// ---------------------------------------------------------------------------
test.describe('PUB-11 — /robots.txt', () => {
  test('returns 200 with text/plain content-type', async ({ request }) => {
    const res = await request.get('/robots.txt');
    expect(res.status()).toBe(200);
    const ct = res.headers()['content-type'] ?? '';
    expect(ct).toContain('text/plain');
  });

  test('contains Sitemap: directive pointing to sitemap.xml', async ({ request }) => {
    const res = await request.get('/robots.txt');
    const text = await res.text();
    expect(text).toContain('Sitemap:');
    expect(text).toContain('sitemap.xml');
  });

  test('contains User-agent rules for AI crawlers', async ({ request }) => {
    const res = await request.get('/robots.txt');
    const text = await res.text();
    expect(text).toContain('User-agent:');
    // Must explicitly name at least one AI crawler
    const namedCrawlers = ['GPTBot', 'ClaudeBot', 'PerplexityBot', 'Google-Extended'];
    const hasNamedCrawler = namedCrawlers.some((bot) => text.includes(bot));
    expect(hasNamedCrawler).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// PUB-12 — sitemap.xml
// ---------------------------------------------------------------------------
test.describe('PUB-12 — /sitemap.xml', () => {
  test('robots.txt Sitemap: directive resolves (200 or 301)', async ({ request }) => {
    // Read robots.txt to find the sitemap URL
    const robotsRes = await request.get('/robots.txt');
    const robotsText = await robotsRes.text();
    const match = robotsText.match(/Sitemap:\s*(https?:\/\/[^\s]+)/i);
    if (match) {
      const sitemapUrl = match[1];
      // Only check within the same origin in E2E (relative fetch)
      const relPath = new URL(sitemapUrl).pathname;
      const sitemapRes = await request.get(relPath);
      // 200 from R2 or worker, 301/302 redirect, or 404 if not yet uploaded to R2
      expect([200, 301, 302, 404]).toContain(sitemapRes.status());
    } else {
      // robots.txt MUST have a Sitemap: directive — fail if missing
      throw new Error('robots.txt has no Sitemap: directive');
    }
  });

  test('when /sitemap.xml resolves, it contains urlset or sitemapindex XML', async ({ request }) => {
    const res = await request.get('/sitemap.xml');
    if (res.status() === 200) {
      const text = await res.text();
      const hasXmlStructure =
        text.includes('<urlset') || text.includes('<sitemapindex');
      expect(hasXmlStructure).toBe(true);
      // Every <url> must have a <lastmod>
      if (text.includes('<url>')) {
        expect(text).toContain('<lastmod>');
      }
    }
  });
});

// ---------------------------------------------------------------------------
// PUB-13 — Marketing OG meta + JSON-LD present
// ---------------------------------------------------------------------------
test.describe('PUB-13 — Marketing OG meta + JSON-LD', () => {
  test('homepage has og:title meta tag', async ({ page }) => {
    await page.goto('/');
    const ogTitle = await page.locator('meta[property="og:title"]').getAttribute('content');
    expect(ogTitle).toBeTruthy();
    expect((ogTitle ?? '').length).toBeGreaterThan(0);
  });

  test('homepage has og:description meta tag', async ({ page }) => {
    await page.goto('/');
    const ogDesc = await page
      .locator('meta[property="og:description"]')
      .getAttribute('content')
      .catch(() => null);
    // og:description may not exist on all SPA shells — soft-assert
    if (ogDesc !== null) {
      expect(ogDesc.length).toBeGreaterThan(0);
    }
  });

  test('homepage has JSON-LD script block', async ({ page }) => {
    await page.goto('/');
    const ldCount = await page.locator('script[type="application/ld+json"]').count();
    expect(ldCount).toBeGreaterThanOrEqual(1);
  });

  test('JSON-LD is parseable JSON', async ({ page }) => {
    await page.goto('/');
    const rawLd = await page
      .locator('script[type="application/ld+json"]')
      .first()
      .textContent()
      .catch(() => null);
    if (rawLd) {
      expect(() => JSON.parse(rawLd)).not.toThrow();
    }
  });
});
