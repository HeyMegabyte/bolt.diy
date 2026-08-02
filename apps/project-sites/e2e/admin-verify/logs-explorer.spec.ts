/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — the Log Explorer (`/admin/logs`) is
 * backed by REAL data, not a dead 404 tab.
 *
 * The audit found `POST /api/logs/search` + `GET /api/logs/cost-by-route` had NO
 * worker handlers → both 404'd → the component's 404 path set `featureDisabled`
 * → the tab MISLEADINGLY showed "Log Explorer isn't enabled" even though the
 * `log_explorer` flag is stable/100%. Both handlers now exist, backed by
 * Cloudflare Workers Observability (real tail-log data).
 *
 * Verified in a REAL browser (page.evaluate → same-origin fetch, which carries
 * the browser fingerprint that Bot-Fight-Mode challenges a raw curl POST for):
 *  - GET /api/logs/cost-by-route → 200 with real per-route rows,
 *  - POST /api/logs/search → 200 with a real items array.
 *
 * @see {@link ../../src/services/logs_explorer.ts} · {@link ../../src/routes/logs.ts}
 */
import { test, expect } from '@playwright/test';
import { realDataAvailable } from '../helpers/realdata.js';

test.describe('Admin · Log Explorer — real data, not a 404 tab (P0-ADMIN)', () => {
  test('GET /api/logs/cost-by-route returns real per-route cost rows (was 404)', async ({
    page,
  }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    const token = process.env.E2E_API_KEY!;

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const res = await page.evaluate(async (bearer) => {
      const r = await fetch('/api/logs/cost-by-route?range=24h', {
        headers: { Authorization: `Bearer ${bearer}` },
      });
      return { status: r.status, body: await r.json().catch(() => null) };
    }, token);

    expect(res.status, '/api/logs/cost-by-route must be 200 (was 404)').toBe(200);
    const data = (res.body as { data?: { rows?: unknown; grand_total_cost?: unknown } } | null)?.data;
    expect(Array.isArray(data?.rows), 'returns { data: { rows: CostRow[] } }').toBe(true);
    expect(typeof data?.grand_total_cost, 'grand_total_cost is numeric').toBe('number');
    // The platform has live traffic → real routes attributed.
    const rows = data!.rows as Array<{ route: string; request_count: number; cost_share_pct: number }>;
    expect(rows.length, 'real routes attributed').toBeGreaterThan(0);
    for (const r of rows) expect(r.request_count).toBeGreaterThan(0);
  });

  test('POST /api/logs/search returns a real log items array (was 404)', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    const token = process.env.E2E_API_KEY!;

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const res = await page.evaluate(async (bearer) => {
      const r = await fetch('/api/logs/search', {
        method: 'POST',
        headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: '', range: '24h', limit: 20 }),
      });
      return { status: r.status, body: await r.json().catch(() => null) };
    }, token);

    expect(res.status, '/api/logs/search must be 200 in-browser (was 404)').toBe(200);
    const data = (res.body as { data?: { items?: unknown } } | null)?.data;
    expect(Array.isArray(data?.items), 'returns { data: { items: LogRow[] } }').toBe(true);
    const items = data!.items as Array<{ route: string; level: string }>;
    // Live worker → recent tail logs exist; each row has a route + level.
    expect(items.length, 'real recent tail-log rows').toBeGreaterThan(0);
    expect(typeof items[0].route, 'row has a route').toBe('string');
  });
});
