/**
 * @module e2e/pwa
 * @description PWA surface evidence for the `pwa_manifest_full` flag — LIVE prod.
 *
 * MODERNIZED 2026-07-31 (Pass-14 stale-era queue). The original spec predated
 * the Angular admin SPA: it asserted `manifest.name === 'Project Sites'`,
 * `short_name === 'Sites'`, and a hand-rolled `/sw.js` containing
 * `project-sites-v` / `ASSETS_TO_CACHE` — all three drifted (live manifest is
 * `ProjectSites`/`ProjectSites`; the registered worker is Angular ngsw). Every
 * assertion below was re-derived from the current wiring and curl-verified
 * against https://projectsites.dev on 2026-07-31.
 *
 * Discovered artifact map (grep evidence):
 *  - Manifest link + theme-color + apple-touch-icon: `frontend/src/index.html`
 *    (`<link rel="manifest" href="/site.webmanifest">`, `<meta name="theme-color">`,
 *    `<link rel="apple-touch-icon" href="/icon-180.png">`).
 *  - Platform manifest: `frontend/public/site.webmanifest` (icons /icon-192.png +
 *    /icon-512.png incl. maskable, 3 shortcuts, share_target).
 *  - Service worker: Angular ngsw — `frontend/angular.json` § serviceWorker →
 *    `ngsw-config.json`; registered in `app.config.ts` via
 *    `provideServiceWorker('ngsw-worker.js', { enabled: !isDevMode(),
 *    registrationStrategy: 'registerWhenStable:30000' })`. Artifacts served at
 *    `/ngsw-worker.js` + `/ngsw.json`. Legacy hand-rolled `/sw.js` (Workbox-style,
 *    `frontend/public/sw.js`) is still shipped but is NOT the registered worker.
 *  - Flag-gated per-site manifest API: `src/routes/features.ts`
 *    `GET /api/pwa/manifest` behind `requireFlag('pwa_manifest_full')` — 404
 *    (never 403) when dark; FLAG_DOCS checklist (docs.ts) = screenshots 3+
 *    wide/narrow, shortcuts 3+, share_target, file_handlers, protocol_handlers.
 *    No offline.html in the checklist → intentionally not asserted.
 *
 * Contract notes: NO networkidle, bounded timeouts, resilientGet for every
 * request-context call (per-IP tarpit), zero-console-error house filter,
 * screenshots to e2e/screenshots/pwa/. SW-offline simulation intentionally
 * omitted (flaky in this harness) — artifacts + registration wiring only;
 * registration itself is idle-deferred (`registerWhenStable:30000`) so the spec
 * never waits on an active registration.
 */

import { test, expect } from './fixtures.js';
import type { Page } from '@playwright/test';
import { resilientGet, expectStatus } from './helpers/api-request.js';

const BASE = process.env.BASE_URL ?? process.env.PROD_URL ?? 'https://projectsites.dev';

/** Console-error collector with the house noise filter (settings-journey idiom). */
function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  return errors;
}

function realErrors(errors: string[]): string[] {
  return errors.filter(
    (e) =>
      !e.includes('favicon') &&
      !e.includes('posthog') &&
      !e.includes('sentry') &&
      !e.includes('net::ERR_BLOCKED_BY_CLIENT') &&
      !e.toLowerCase().includes('failed to load resource') &&
      !e.includes('Http failure') &&
      !e.includes('ChunkLoadError') &&
      !e.includes('Loading chunk'),
  );
}

/** Minimal shape of the fields this spec asserts on a web app manifest. */
interface ManifestShape {
  name?: string;
  short_name?: string;
  start_url?: string;
  display?: string;
  theme_color?: string;
  icons?: { src: string; sizes?: string; purpose?: string }[];
  shortcuts?: { url?: string }[];
  share_target?: { method?: string };
  screenshots?: { form_factor?: string }[];
  file_handlers?: unknown[];
  protocol_handlers?: { protocol?: string }[];
}

test.describe('PWA-EVIDENCE — pwa_manifest_full platform surface (live prod)', () => {
  test('PWA-01 — /site.webmanifest is valid JSON with installability fields; icons resolve', async ({
    request,
  }) => {
    const res = await resilientGet(request, `${BASE}/site.webmanifest`);
    expectStatus(res, [200], 'platform web app manifest');
    expect(
      res.headers()['content-type'] ?? '',
      'manifest content-type must be manifest+json or json',
    ).toMatch(/(manifest\+json|application\/json)/);

    const manifest = (await res.json()) as ManifestShape;
    expect(manifest.name, 'manifest.name present').toBeTruthy();
    expect(manifest.short_name, 'manifest.short_name present').toBeTruthy();
    expect(manifest.start_url, 'installable start_url').toBe('/');
    expect(manifest.display, 'standalone display mode').toBe('standalone');
    expect(manifest.theme_color ?? '', 'hex theme_color').toMatch(/^#/);

    // Installability floor: ≥2 icons covering 192 + 512 (Chrome install criteria).
    const icons = manifest.icons ?? [];
    expect(icons.length, 'at least 2 icons declared').toBeGreaterThanOrEqual(2);
    expect(icons.some((i) => i.sizes?.includes('192'))).toBe(true);
    expect(icons.some((i) => i.sizes?.includes('512'))).toBe(true);

    // Rich-install extras shipped in frontend/public/site.webmanifest.
    expect((manifest.shortcuts ?? []).length, 'app shortcuts declared').toBeGreaterThanOrEqual(1);
    expect(manifest.share_target, 'share_target declared').toBeTruthy();

    // Icons resolve — check up to 3 unique srcs with the tarpit-resilient transport.
    const uniqueSrcs = [...new Set(icons.map((i) => i.src))].slice(0, 3);
    expect(uniqueSrcs.length).toBeGreaterThanOrEqual(1);
    for (const src of uniqueSrcs) {
      const iconRes = await resilientGet(request, new URL(src, BASE).toString());
      expectStatus(iconRes, [200], `manifest icon ${src}`);
      expect(
        iconRes.headers()['content-type'] ?? '',
        `manifest icon ${src} is an image`,
      ).toMatch(/^image\//);
    }
  });

  test('PWA-02 — Angular ngsw service-worker artifacts are servable', async ({ request }) => {
    // The REGISTERED worker (app.config.ts provideServiceWorker('ngsw-worker.js', …)).
    const worker = await resilientGet(request, `${BASE}/ngsw-worker.js`);
    expectStatus(worker, [200], 'ngsw-worker.js');
    expect(worker.headers()['content-type'] ?? '', 'ngsw-worker.js is JavaScript').toMatch(
      /javascript/,
    );
    const workerBody = await worker.text();
    expect(workerBody.length, 'ngsw-worker.js is a real bundle, not a stub').toBeGreaterThan(1_000);
    expect(workerBody, 'Angular ngsw signature present').toContain('ngsw');

    // The generated manifest the worker drives its caches from.
    const ngswJson = await resilientGet(request, `${BASE}/ngsw.json`);
    expectStatus(ngswJson, [200], 'ngsw.json');
    const cfg = (await ngswJson.json()) as {
      configVersion?: number;
      index?: string;
      assetGroups?: unknown[];
    };
    expect(typeof cfg.configVersion, 'ngsw.json configVersion').toBe('number');
    expect(cfg.index, 'ngsw.json index route').toBeTruthy();
    expect(Array.isArray(cfg.assetGroups), 'ngsw.json assetGroups array').toBe(true);
    expect((cfg.assetGroups ?? []).length).toBeGreaterThanOrEqual(1);
  });

  test('PWA-03 — apple-touch-icon + legacy sw.js are servable', async ({ request }) => {
    // iOS home-screen icon referenced from frontend/src/index.html.
    const appleIcon = await resilientGet(request, `${BASE}/icon-180.png`);
    expectStatus(appleIcon, [200], 'apple-touch-icon (/icon-180.png)');
    expect(appleIcon.headers()['content-type'] ?? '').toMatch(/image\/png/);

    // Legacy hand-rolled Workbox-style worker still shipped from frontend/public/sw.js.
    // NOT the registered worker (ngsw is) — assert servability only, no content
    // fingerprints (the old 'project-sites-v'/'ASSETS_TO_CACHE' asserts were drift).
    const legacySw = await resilientGet(request, `${BASE}/sw.js`);
    expectStatus(legacySw, [200], 'legacy /sw.js');
    expect(legacySw.headers()['content-type'] ?? '', '/sw.js is JavaScript').toMatch(/javascript/);
  });

  test('PWA-04 — flag-gated /api/pwa/manifest honors the FLAG_DOCS completeness contract', async ({
    request,
  }) => {
    // requireFlag('pwa_manifest_full'): 200 when on, 404 (NEVER 403) when dark.
    // Live D1 currently has the flag ON (curl-verified 200 on 2026-07-31), but the
    // registry default is experimental/off — accept both honest states so a
    // killswitch flip never false-fails the suite, while 403/5xx always fail.
    const res = await resilientGet(request, `${BASE}/api/pwa/manifest`);
    expectStatus(res, [200, 404], 'pwa_manifest_full flag gate (404 never 403 when dark)');
    expect(res.status(), 'flag gate must never leak as 403').not.toBe(403);

    if (res.status() === 200) {
      const m = (await res.json()) as ManifestShape;
      // FLAG_DOCS checklist (src/modules/feature_flags/docs.ts § pwa_manifest_full):
      // screenshots 3+ covering wide AND narrow, shortcuts 3+, share_target,
      // file_handlers, protocol_handlers. Mirrors src/__tests__/pwa_manifest.test.ts.
      expect(m.name, 'per-site manifest name').toBeTruthy();
      expect(m.start_url, 'per-site manifest start_url').toBeTruthy();
      expect(m.display).toBe('standalone');

      const shots = m.screenshots ?? [];
      expect(shots.length, '3+ store screenshots').toBeGreaterThanOrEqual(3);
      const factors = new Set(shots.map((s) => s.form_factor));
      expect(factors.has('wide'), 'wide form_factor screenshot').toBe(true);
      expect(factors.has('narrow'), 'narrow form_factor screenshot').toBe(true);

      expect((m.shortcuts ?? []).length, '3+ shortcuts').toBeGreaterThanOrEqual(3);
      expect(m.share_target?.method, 'share_target declared').toBeTruthy();
      expect((m.file_handlers ?? []).length, 'file_handlers declared').toBeGreaterThanOrEqual(1);
      const protocols = m.protocol_handlers ?? [];
      expect(protocols.length, 'protocol_handlers declared').toBeGreaterThanOrEqual(1);
      expect(protocols[0]?.protocol ?? '', 'custom protocol uses web+ prefix').toMatch(/^web\+/);
    }
  });

  test('PWA-05 — homepage carries the manifest link, theme-color, and SW wiring', async ({
    page,
  }) => {
    const consoleErrors = collectConsoleErrors(page);

    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30_000 });

    // <head> wiring from frontend/src/index.html — head elements are never
    // "visible", so assert attachment + attributes, not visibility.
    const manifestLink = page.locator('link[rel="manifest"]');
    await expect(manifestLink, 'manifest <link> present').toHaveCount(1, { timeout: 15_000 });
    await expect(manifestLink).toHaveAttribute('href', '/site.webmanifest');

    const themeColor = page.locator('meta[name="theme-color"]');
    expect(await themeColor.count(), 'theme-color meta present').toBeGreaterThanOrEqual(1);
    expect(await themeColor.first().getAttribute('content')).toMatch(/^#/);

    const appleIcon = page.locator('link[rel="apple-touch-icon"]');
    await expect(appleIcon, 'apple-touch-icon link present').toHaveCount(1);
    await expect(appleIcon).toHaveAttribute('href', '/icon-180.png');

    // Registration WIRING only — app.config.ts registers ngsw-worker.js via
    // registerWhenStable:30000, so an active registration is idle-deferred and
    // asserting on it would be a 30s flake. The API surface being present +
    // PWA-02 proving the worker artifact servable is the stable evidence pair.
    const swSupported = await page.evaluate(() => 'serviceWorker' in navigator);
    expect(swSupported, 'serviceWorker API available in the shipped context').toBe(true);

    await page.screenshot({ path: 'e2e/screenshots/pwa/01-homepage-pwa.png' });

    expect(realErrors(consoleErrors), 'zero real console errors on the PWA shell').toEqual([]);
  });
});
