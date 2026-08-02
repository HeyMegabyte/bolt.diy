/**
 * @module e2e/helpers/realdata
 *
 * Real-data VISUAL verification for the P0-ADMIN mandate (Brian 2026-08-02):
 * render an admin section against LIVE prod data in a real browser and screenshot
 * it, without the 401-bounce that unstubbed `/api` GETs cause under a test session.
 *
 * The auth session token IS the `E2E_API_KEY` (`_injectSession`), so the SPA's
 * `ApiService` sends `Authorization: Bearer <E2E_API_KEY>` on every call and the
 * worker authenticates it as the test/sysadmin user. So a `route.continue()`
 * passthrough for the section-under-test hits REAL prod → real data renders in the
 * UI; every OTHER `/api` call gets a benign stub so it never 401s → session-clear
 * → `/signin` bounce (directive #4).
 *
 * @example
 * ```ts
 * import { test, expect } from '@playwright/test';
 * import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';
 * test('analytics renders real data', async ({ page }) => {
 *   test.skip(!realDataAvailable(), 'needs E2E_API_KEY');
 *   await setupRealDataPage(page, { passthrough: /\/api\/sites/ });
 *   await page.goto('/admin/analytics');
 *   // …assert populated + screenshot…
 * });
 * ```
 */
import type { Page } from '@playwright/test';

const DEFAULT_EMAIL = 'brian@megabyte.space';

/** True when a real session key is present (else skip real-data visual tests). */
export function realDataAvailable(): boolean {
  return Boolean(process.env.E2E_API_KEY);
}

/**
 * Inject a real session + route `/api` so ONLY the passthrough endpoints hit live
 * prod (real data); all other `/api` calls get a benign stub (no 401-bounce).
 *
 * @param page - a CDN-blocked Playwright `page` (base fixture).
 * @param opts.passthrough - RegExp matched against the request URL; matches hit real prod.
 * @param opts.email - session identity (default `brian@megabyte.space`).
 * @throws {Error} when `E2E_API_KEY` is unset.
 */
export async function setupRealDataPage(
  page: Page,
  opts: { passthrough: RegExp; email?: string },
): Promise<void> {
  const token = process.env.E2E_API_KEY;
  if (!token) throw new Error('setupRealDataPage requires E2E_API_KEY');
  const email = opts.email ?? DEFAULT_EMAIL;

  await page.context().addInitScript(
    ({ t, id }: { t: string; id: string }) => {
      localStorage.setItem(
        'ps_session',
        JSON.stringify({ token: t, identifier: id, createdAt: Date.now() }),
      );
    },
    { t: token, id: email },
  );

  await page.route('**/api/**', async (route) => {
    const url = route.request().url();
    // Auth + the section-under-test hit REAL prod (authed → real data).
    if (/\/api\/auth\/me\b/.test(url) || opts.passthrough.test(url)) {
      await route.continue();
      return;
    }
    // Everything else: benign stub so an unstubbed GET never 401s → bounce.
    const method = route.request().method();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: method === 'GET' ? '{"data":[]}' : '{"ok":true}',
    });
  });
}
