/**
 * @module e2e/admin-auth-sweep
 *
 * Regression guard for the auth-class sweep (rounds 101-103).
 *
 * Five admin sections used to call session-scoped worker endpoints via a raw
 * `HttpClient` with NO Authorization header → the worker received no session →
 * `c.get('orgId')` was empty → the sections were silently broken (empty/404,
 * dead buttons). They were routed through `ApiService`, which injects
 * `Authorization: Bearer <token>` on every call.
 *
 * This spec asserts the OUTGOING request carries a Bearer header. We assert on
 * the REQUEST (captured at send-time by `waitForRequest`), NOT the response —
 * so the guard holds regardless of whether the test token is honoured or 401s
 * (a 401 + /signin redirect happens AFTER the request is already on the wire).
 * If any of these sections regresses to raw `HttpClient`, the Bearer header
 * disappears and this fails.
 *
 * Reliable hard-asserts: content-freshness + inbox both fire their `/api` call
 * unconditionally in `ngOnInit`. site-detail is best-effort (needs a real site
 * id reached via the /admin/sites list; skips cleanly when the test token
 * surfaces no site rows).
 *
 * Seeds `ps_session` from `E2E_API_KEY`. Run:
 *   E2E_API_KEY=psk_test_… npx playwright test --config=playwright.prod.config.ts admin-auth-sweep
 */
import { test, expect, type Page } from '@playwright/test';

const KEY = process.env.E2E_API_KEY ?? '';

async function seed(page: Page): Promise<void> {
  await page.addInitScript((k: string) => {
    try {
      localStorage.setItem(
        'ps_session',
        JSON.stringify({ token: k, identifier: 'test@megabyte.space', createdAt: Date.now() }),
      );
      localStorage.setItem('ps_feedback_dismissed', 'true');
    } catch { /* private mode */ }
  }, KEY);
}

const BEARER = /^Bearer .+/;

test.describe('admin — auth-class regression guard (rounds 101-103)', () => {
  test.skip(!KEY, 'E2E_API_KEY not set');
  test.describe.configure({ retries: 2 });

  // Sections whose /api call fires unconditionally on load → hard assert.
  const ON_LOAD: { path: string; match: RegExp; label: string }[] = [
    { path: '/admin/content-freshness', match: /\/api\/content\/freshness/, label: 'content-freshness' },
    { path: '/admin/inbox', match: /\/api\/inbox\/conversations/, label: 'inbox' },
  ];

  for (const s of ON_LOAD) {
    test(`${s.label}: outgoing /api request carries Authorization: Bearer`, async ({ page }) => {
      test.setTimeout(60000);
      await seed(page);
      const reqP = page.waitForRequest((r) => s.match.test(r.url()), { timeout: 30000 });
      await page.goto(s.path, { waitUntil: 'load' });
      const req = await reqP;
      const auth = req.headers()['authorization'] ?? '';
      expect(auth, `${s.label} must attach a Bearer token (regressed to raw HttpClient?)`).toMatch(BEARER);
    });
  }

  test('site-detail: tab /api requests carry Authorization: Bearer (or skip when no site row)', async ({ page }) => {
    test.setTimeout(60000);
    await seed(page);
    await page.goto('/admin/sites', { waitUntil: 'load' });
    await expect(page.locator('.admin-sidebar').first()).toBeVisible({ timeout: 30000 });

    const siteLink = page.locator('a[href^="/admin/sites/"]').first();
    if ((await siteLink.count()) === 0) {
      test.skip(true, 'No site rows from the test token — site-detail deep-link needs a real site id.');
      return;
    }
    const href = (await siteLink.getAttribute('href')) ?? '';
    const id = href.match(/\/admin\/sites\/([^/]+)/)?.[1];
    if (!id) {
      test.skip(true, 'Could not parse a site id from the site-list href.');
      return;
    }

    // The Logs tab loads on mount → /api/sites/:id/logs/tail (+ /snapshots).
    const reqP = page.waitForRequest((r) => /\/api\/sites\/[^/]+\/(logs\/tail|snapshots)/.test(r.url()), { timeout: 25000 });
    await page.goto(`/admin/sites/${id}`, { waitUntil: 'load' });
    const req = await reqP;
    const auth = req.headers()['authorization'] ?? '';
    expect(auth, 'site-detail must attach a Bearer token on its tab API calls').toMatch(BEARER);
  });
});
