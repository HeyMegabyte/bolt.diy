/**
 * @module e2e/api-contract
 *
 * Dead-endpoint guard. Every worker endpoint the frontend calls must return
 * JSON (200 or a clean 4xx) — NEVER the SPA index.html (200 text/html), which
 * is what an UNREGISTERED `/api/*` route falls through to. A text/html
 * response means the route doesn't exist on the worker → the calling feature
 * silently breaks (parse failure → spurious error toast). This caught the dead
 * `/api/admin/sessions` route (fixed 2026-06-02); this test keeps the surface
 * at zero dead endpoints.
 *
 * Uses Playwright's request context with the E2E bearer. A 401/403/404 with a
 * JSON content-type is FINE (real route, flag-gated or unauthorized) — only
 * `text/html` fails. Run:
 *   E2E_API_KEY=… npx playwright test --config=playwright.prod.config.ts api-contract
 */
import { test, expect, request as pwRequest } from '@playwright/test';

const KEY = process.env.E2E_API_KEY ?? '';
const BASE = 'https://projectsites.dev';

// Endpoints whose worker route is intentionally not-yet-built. The frontend
// handles their absence gracefully (e.g. /api/admin/sessions uses a silent raw
// fetch + current-device fallback). They're allow-listed so this test passes
// today but still fails the moment a NEW dead endpoint appears. Remove an entry
// here once its worker route ships (then it must return JSON like the rest).
const KNOWN_PENDING = new Set<string>([
  '/api/admin/sessions', // multi-session management backend pending (worker, Docker-blocked)
]);

// No-param admin + public endpoints the frontend GETs on load.
const STATIC_GETS = [
  '/api/admin/api-keys', '/api/admin/forecast/cost', '/api/admin/security', '/api/admin/sessions',
  '/api/billing/credits', '/api/billing/entitlements', '/api/billing/site-costs',
  '/api/billing/spend-alerts', '/api/billing/subscription', '/api/enterprise/contract',
  '/api/enterprise/sla', '/api/stripe-app/summary', '/api/team', '/api/trust/profile', '/api/wallet',
  '/api/public/integrations', '/api/public/roadmap',
];

// Per-site endpoints (resolved against a real site id at runtime).
const PER_SITE_GETS = [
  'ai-endpoints', 'ai-logs', 'ai-settings', 'ai/context/files', 'credit-cap',
  'form-submissions', 'github/status', 'hostnames', 'logs/tail', 'mcp/connections', 'snapshots',
];

test.describe('frontend→worker API contract — no dead endpoints (SPA-HTML)', () => {
  test.skip(!KEY, 'E2E_API_KEY not set');
  test.describe.configure({ retries: 2 });

  test('every frontend-called endpoint returns JSON, never the SPA shell', async () => {
    test.setTimeout(90000);
    const ctx = await pwRequest.newContext({
      baseURL: BASE,
      extraHTTPHeaders: { Authorization: `Bearer ${KEY}`, 'User-Agent': 'Mozilla/5.0 (api-contract-e2e)' },
    });

    // Resolve a real site id for the per-site routes.
    const sitesRes = await ctx.get('/api/sites');
    const sitesBody = await sitesRes.json().catch(() => ({}));
    const siteId =
      (Array.isArray(sitesBody?.data) && sitesBody.data[0]?.id) ||
      (Array.isArray(sitesBody?.sites) && sitesBody.sites[0]?.id) ||
      null;

    const urls = [...STATIC_GETS];
    if (siteId) for (const ep of PER_SITE_GETS) urls.push(`/api/sites/${siteId}/${ep}`);

    const dead: string[] = [];
    for (const u of urls) {
      const res = await ctx.get(u);
      const ct = (res.headers()['content-type'] ?? '').toLowerCase();
      if (ct.includes('text/html') && !KNOWN_PENDING.has(u)) dead.push(`${u}  →  ${res.status()} text/html`);
    }
    await ctx.dispose();

    expect(dead, `NEW dead endpoints (return the SPA shell — route missing on the worker):\n${dead.join('\n')}`).toEqual([]);
  });
});
