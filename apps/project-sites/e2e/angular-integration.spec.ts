/**
 * Angular Frontend Integration Tests for Production.
 *
 * Verifies that projectsites.dev serves the Angular (Ionic) app
 * instead of the legacy vanilla JS SPA. These tests use both the
 * Playwright API context (HTML source checks) and a browser page
 * (Angular bootstrap + Ionic component rendering).
 *
 * Run against production:
 *   BASE_URL=https://projectsites.dev npx playwright test e2e/angular-integration.spec.ts
 */
import { test, expect } from '@playwright/test';

test.describe('Angular Source Integration', () => {
  test('homepage HTML contains <app-root> element', async ({ request }) => {
    const res = await request.get('/');
    expect(res.status()).toBe(200);
    const html = await res.text();
    expect(html).toContain('<app-root>');
  });

  test('homepage HTML does NOT contain vanilla SPA inline scripts', async ({ request }) => {
    const res = await request.get('/');
    const html = await res.text();
    // The vanilla SPA loaded Uppy, JSZip, CodeMirror from CDN inline
    expect(html).not.toContain('releases.transloadit.com/uppy');
    expect(html).not.toContain('cdnjs.cloudflare.com/ajax/libs/jszip');
    expect(html).not.toContain('cdnjs.cloudflare.com/ajax/libs/codemirror');
    // The vanilla SPA had thousands of lines of inline JavaScript
    expect(html.length).toBeLessThan(20_000);
  });

  test('homepage HTML includes Angular hashed main bundle', async ({ request }) => {
    const res = await request.get('/');
    const html = await res.text();
    // Angular CLI outputs main-<HASH>.js
    expect(html).toMatch(/main-[A-Z0-9]+\.js/);
  });

  test('homepage HTML includes Angular polyfills bundle', async ({ request }) => {
    const res = await request.get('/');
    const html = await res.text();
    // Angular CLI outputs polyfills-<HASH>.js
    expect(html).toMatch(/polyfills-[A-Z0-9]+\.js/);
  });

  test('homepage HTML includes hashed stylesheet', async ({ request }) => {
    const res = await request.get('/');
    const html = await res.text();
    // Angular CLI outputs styles-<HASH>.css
    expect(html).toMatch(/styles-[A-Z0-9]+\.css/);
  });

  test('Angular main bundle is loadable', async ({ request }) => {
    const indexRes = await request.get('/');
    const html = await indexRes.text();
    const mainMatch = html.match(/(main-[A-Z0-9]+\.js)/);
    expect(mainMatch).not.toBeNull();

    const bundleRes = await request.get(`/${mainMatch![1]}`);
    expect(bundleRes.status()).toBe(200);
    expect(bundleRes.headers()['content-type']).toContain('javascript');
  });

  test('Angular polyfills bundle is loadable', async ({ request }) => {
    const indexRes = await request.get('/');
    const html = await indexRes.text();
    const polyfillsMatch = html.match(/(polyfills-[A-Z0-9]+\.js)/);
    expect(polyfillsMatch).not.toBeNull();

    const bundleRes = await request.get(`/${polyfillsMatch![1]}`);
    expect(bundleRes.status()).toBe(200);
    expect(bundleRes.headers()['content-type']).toContain('javascript');
  });

  test('Angular stylesheet is loadable', async ({ request }) => {
    const indexRes = await request.get('/');
    const html = await indexRes.text();
    const stylesMatch = html.match(/(styles-[A-Z0-9]+\.css)/);
    expect(stylesMatch).not.toBeNull();

    const bundleRes = await request.get(`/${stylesMatch![1]}`);
    expect(bundleRes.status()).toBe(200);
    expect(bundleRes.headers()['content-type']).toContain('css');
  });

  test('Angular chunk files are loadable', async ({ request }) => {
    const indexRes = await request.get('/');
    const html = await indexRes.text();
    const chunks = [...html.matchAll(/chunk-[A-Z0-9]+\.js/g)].map((m) => m[0]);
    expect(chunks.length).toBeGreaterThan(0);

    // Verify at least 3 chunks are loadable
    const toCheck = chunks.slice(0, 3);
    for (const chunk of toCheck) {
      const res = await request.get(`/${chunk}`);
      expect(res.status()).toBe(200);
    }
  });

  test('SPA fallback serves index.html for /signin route', async ({ request }) => {
    const res = await request.get('/signin');
    expect(res.status()).toBe(200);
    const html = await res.text();
    expect(html).toContain('<app-root>');
    expect(html).toMatch(/main-[A-Z0-9]+\.js/);
  });

  test('SPA fallback serves index.html for /admin route', async ({ request }) => {
    const res = await request.get('/admin');
    expect(res.status()).toBe(200);
    const html = await res.text();
    expect(html).toContain('<app-root>');
  });

  test('SPA fallback serves index.html for /details route', async ({ request }) => {
    const res = await request.get('/details');
    expect(res.status()).toBe(200);
    const html = await res.text();
    expect(html).toContain('<app-root>');
  });
});

test.describe('Angular Bootstrap in Browser', () => {
  test('Angular app bootstraps and renders ion-app', async ({ page }) => {
    await page.goto('/');
    // Angular bootstraps and Ionic renders ion-app as a top-level element
    await expect(page.locator('ion-app')).toBeAttached({ timeout: 15_000 });
  });

  test('Angular renders the header component', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('app-header')).toBeAttached({ timeout: 15_000 });
  });

  test('Angular renders the search page hero section', async ({ page }) => {
    await page.goto('/');
    // Wait for Angular to bootstrap and render hero content
    await expect(page.locator('.hero-brand h1')).toBeAttached({ timeout: 15_000 });
    await expect(page.locator('.hero-brand h1')).toContainText('Handled');
  });

  test('Angular renders the Ionic searchbar', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('ion-searchbar')).toBeAttached({ timeout: 15_000 });
  });

  test('Angular renders the pricing section with Ionic toggle', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('ion-toggle')).toBeAttached({ timeout: 15_000 });
  });

  test('Angular renders the FAQ accordion group', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('ion-accordion-group')).toBeAttached({ timeout: 15_000 });
  });

  test('/signin route renders the signin component', async ({ page }) => {
    await page.goto('/signin');
    await expect(page.locator('.signin-card')).toBeAttached({ timeout: 15_000 });
  });

  test('/details route renders the details component', async ({ page }) => {
    await page.goto('/details');
    await expect(page.locator('.details-card')).toBeAttached({ timeout: 15_000 });
  });
});
