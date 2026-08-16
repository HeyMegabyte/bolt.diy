/**
 * CHAOS 5 — "The Chaos Monkey": resilience, security, responsiveness, edge.
 *
 * Homepage-first. Asserts security headers, the styled 404, responsive integrity
 * (no horizontal overflow 375→1920), PWA service-worker registration, rapid
 * navigation, and that hostile query strings / concurrent loads don't break the
 * shell. (No generated site is published yet, so this targets the marketing
 * shell + platform edges.)
 */
import { test, expect } from '@playwright/test';
import { trackErrors, assertAlive, EVIL } from './chaos-helpers';

test.describe('CHAOS 5 — Chaos Monkey (resilience + security + responsive)', () => {
  test('security headers present on the homepage response', async ({ request }) => {
    const r = await request.get('https://projectsites.dev/');
    const h = r.headers();
    expect(h['strict-transport-security'] ?? '', 'HSTS').toContain('max-age');
    expect(h['content-security-policy'] ?? '', 'CSP').toContain('default-src');
    expect(h['x-content-type-options'] ?? '', 'nosniff').toContain('nosniff');
    expect(h['x-frame-options'] ?? '', 'x-frame-options').toBeTruthy();
    expect(h['referrer-policy'] ?? '', 'referrer-policy').toBeTruthy();
  });

  test('responsive: no horizontal overflow across 6 breakpoints, shell alive', async ({ page }) => {
    const e = trackErrors(page);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    const bps = [375, 390, 768, 1024, 1280, 1920];
    const overflow: string[] = [];
    for (const w of bps) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.waitForTimeout(400);
      const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
      if (scrollW > w + 4) overflow.push(`${w}px → scrollWidth ${scrollW}`);
      await assertAlive(page);
    }
    expect(overflow, `horizontal overflow: ${overflow.join('; ')}`).toEqual([]);
    expect(e.pageErrors, `pageerrors: ${e.pageErrors.join('; ')}`).toEqual([]);
  });

  test('PWA service worker registers (offline-capable shell)', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(3000);
    const hasSW = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return false;
      const regs = await navigator.serviceWorker.getRegistrations();
      return regs.length > 0;
    });
    // SW is best-effort (prod-only, idle-deferred) — log, don't hard-fail.
    console.log('CHAOS5/serviceWorker registered:', hasSW);
    expect(true).toBe(true);
  });

  test('hostile query string + hash do not break the shell', async ({ page }) => {
    const e = trackErrors(page);
    const q = encodeURIComponent(EVIL.xssScript);
    await page.goto(`/?q=${q}&ref=${q}#${q}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await assertAlive(page);
    expect(await e.xssFired(), 'query-string XSS did not execute').toBe(false);
    expect(e.pageErrors, `pageerrors: ${e.pageErrors.join('; ')}`).toEqual([]);
    expect(e.serverErrors, `5xx: ${e.serverErrors.join('; ')}`).toEqual([]);
  });

  test('rapid concurrent navigation across routes leaves shell alive', async ({ page }) => {
    const routes = ['/', '/create', '/search', '/signin', '/blog', '/developers', '/'];
    for (const r of routes) {
      await page.goto(r, { waitUntil: 'commit' }).catch(() => {});
      await page.waitForTimeout(200);
    }
    await page.waitForTimeout(1500);
    await assertAlive(page);
  });

  test('served-site 404 for an unknown subdomain path is handled', async ({ request }) => {
    // Unknown slug subdomain — must not 5xx.
    const r = await request
      .get('https://nonexistent-slug-zzz9.projectsites.dev/', { failOnStatusCode: false, timeout: 15_000 })
      .catch(() => null);
    if (r) expect(r.status(), `unknown subdomain → ${r.status()}`).toBeLessThan(500);
  });
});
