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
 * Reliable hard-assert: the sites list (`listSites` → GET /api/sites) fires
 * unconditionally on admin init. site-detail is best-effort (needs a real site
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
    } catch {
      /* private mode */
    }
  }, KEY);
}

const BEARER = /^Bearer .+/;

test.describe('admin — auth-class regression guard (rounds 101-103)', () => {
  test.skip(!KEY, 'E2E_API_KEY not set');
  test.describe.configure({ retries: 2 });

  // A section whose /api call fires UNCONDITIONALLY on load → hard-assert the
  // Bearer header. Uses the sites list (`ApiService.listSites()` → GET /api/sites),
  // fired by AdminStateService on every admin init — the most reliable always-on
  // org-scoped GET. (The prior `content-freshness` example was removed 2026-08-08:
  // its route + component were DELETED, so /admin/content-freshness now hits the
  // admin not-found catch-all and fires no /api/content/freshness request. inbox
  // was likewise dropped when round 111 flag-gated its fetch — the flag-off
  // no-fetch behavior is covered by admin-flag-gated.e2e.ts.)
  const ON_LOAD: { path: string; match: RegExp; label: string }[] = [
    { path: '/admin/sites', match: /\/api\/sites/, label: 'sites (listSites via ApiService)' },
  ];

  for (const s of ON_LOAD) {
    test(`${s.label}: outgoing /api request carries Authorization: Bearer`, async ({ page }) => {
      test.setTimeout(60000);
      await seed(page);
      const reqP = page.waitForRequest((r) => s.match.test(r.url()), { timeout: 30000 });
      await page.goto(s.path, { waitUntil: 'load' });
      const req = await reqP;
      const auth = req.headers()['authorization'] ?? '';
      expect(auth, `${s.label} must attach a Bearer token (regressed to raw HttpClient?)`).toMatch(
        BEARER,
      );
    });
  }

  test('site-detail: tab /api requests carry Authorization: Bearer (or skip when no site row)', async ({
    page,
  }) => {
    test.setTimeout(60000);
    await seed(page);
    await page.goto('/admin/sites', { waitUntil: 'load' });
    await expect(page.locator('.admin-sidebar').first()).toBeVisible({ timeout: 30000 });

    const siteLink = page.locator('a[href^="/admin/sites/"]').first();
    if ((await siteLink.count()) === 0) {
      test.skip(
        true,
        'No site rows from the test token — site-detail deep-link needs a real site id.',
      );
      return;
    }
    const href = (await siteLink.getAttribute('href')) ?? '';
    const id = href.match(/\/admin\/sites\/([^/]+)/)?.[1];
    if (!id) {
      test.skip(true, 'Could not parse a site id from the site-list href.');
      return;
    }

    // The Logs tab loads on mount → /api/sites/:id/logs/tail (+ /snapshots).
    const reqP = page.waitForRequest(
      (r) => /\/api\/sites\/[^/]+\/(logs\/tail|snapshots)/.test(r.url()),
      { timeout: 25000 },
    );
    await page.goto(`/admin/sites/${id}`, { waitUntil: 'load' });
    const req = await reqP;
    const auth = req.headers()['authorization'] ?? '';
    expect(auth, 'site-detail must attach a Bearer token on its tab API calls').toMatch(BEARER);
  });

  // PARAM SUB-ROUTES — the exact routes that had the raw-HttpClient auth bug
  // (admin-raw-httpclient-auth-gap: mcp-server/branches always-broken,
  // swarm/copilot latent-flag-gated, all fixed 2026-06-06). The top-level sweep
  // above never reached these → all 4 bugs slipped through. Assert each fires
  // its /api call WITH a Bearer. We assert on the REQUEST, so a flag-gated 404
  // (swarm/copilot when the flag is off) is irrelevant — the header is on the
  // wire at send-time regardless. If any regresses to raw HttpClient, the Bearer
  // vanishes and this fails.
  const SUBROUTES: { route: (id: string) => string; match: RegExp; label: string }[] = [
    {
      route: (id) => `/admin/sites/${id}/mcp-server`,
      match: /\/api\/sites\/[^/]+\/mcp\/tokens/,
      label: 'site-mcp-server',
    },
    {
      route: (id) => `/admin/sites/${id}/branches`,
      match: /\/api\/sites\/[^/]+\/branches/,
      label: 'site-branches',
    },
    { route: (id) => `/admin/swarm/${id}`, match: /\/api\/swarm\/[^/]+\/runs/, label: 'swarm' },
    {
      route: (id) => `/admin/sites/${id}/copilot`,
      match: /\/api\/sites\/[^/]+\/copilot\/(config|sessions)/,
      label: 'site-copilot',
    },
  ];

  async function firstSiteId(page: Page): Promise<string | null> {
    await page.goto('/admin/sites', { waitUntil: 'load' });
    await expect(page.locator('.admin-sidebar').first()).toBeVisible({ timeout: 30000 });
    const link = page.locator('a[href^="/admin/sites/"]').first();
    if ((await link.count()) === 0) return null;
    return (await link.getAttribute('href'))?.match(/\/admin\/sites\/([^/]+)/)?.[1] ?? null;
  }

  for (const s of SUBROUTES) {
    test(`${s.label}: param-route /api request carries Authorization: Bearer`, async ({ page }) => {
      test.setTimeout(60000);
      await seed(page);
      const id = await firstSiteId(page);
      if (!id) {
        test.skip(true, 'No site rows from the test token — param sub-route needs a real site id.');
        return;
      }
      const reqP = page.waitForRequest((r) => s.match.test(r.url()), { timeout: 25000 });
      await page.goto(s.route(id), { waitUntil: 'load' });
      const req = await reqP;
      const auth = req.headers()['authorization'] ?? '';
      expect(auth, `${s.label} must attach a Bearer token (regressed to raw HttpClient?)`).toMatch(
        BEARER,
      );
    });
  }
});
