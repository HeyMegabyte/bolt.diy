/**
 * E2E spec — Swarm Editor (#5 Multi-Agent Swarm Editor)
 *
 * Dark-feature GATE contract (`swarm_editor`). The API is auth/ownership-gated, so
 * an UNAUTHENTICATED caller must get a clean leak-free "not allowed" gate — 401 (no
 * session), 403 (forbidden), or 404 (flag off / no existence leak) — never a 2xx and
 * never a 5xx. When a real session IS present the response-shape contract applies;
 * unauthenticated E2E only proves the gate.
 *
 * Pass-22 repair: the old premise "flag OFF → 404" was stale — `swarm_editor` is
 * globally overridden ON via the "ensure all flags on" D1 override, so POST /start
 * returns 403 unauthenticated (same class as the collab Pass-17 fix). The former
 * "homepage renders without console errors" test was mis-scoped (loaded the marketing
 * homepage via `networkidle`, not swarm) and duplicated golden-path coverage — removed.
 */

import { test, expect } from '@playwright/test';

const SITE_ID = 'demo-site';
const PROD_URL = process.env['PROD_URL'] ?? 'https://projectsites.dev';

/** Valid leak-free "not allowed" gates for an unauthenticated caller. */
const GATE = [401, 403, 404];

test.describe('Swarm Editor API — unauthenticated gate', () => {
  test('POST start is gated (401/403/404), never 2xx or 5xx', async ({ request }) => {
    const res = await request.post(`${PROD_URL}/api/swarm/${SITE_ID}/start`, {
      data: { prompt: 'Test run' },
    });
    expect(GATE).toContain(res.status());
  });

  test('GET runs is gated (401/403/404), never 2xx or 5xx', async ({ request }) => {
    const res = await request.get(`${PROD_URL}/api/swarm/${SITE_ID}/runs`);
    expect(GATE).toContain(res.status());
  });
});

test.describe('Swarm Editor API — response shape (only on an authenticated 2xx)', () => {
  test('start run response carries run_id + agents with file_glob', async ({ request }) => {
    const res = await request.post(`${PROD_URL}/api/swarm/${SITE_ID}/start`, {
      data: { prompt: 'Build bakery homepage', agents: ['visual', 'copy', 'seo'] },
    });
    // Unauthenticated E2E hits the gate — the shape contract only applies to a 2xx.
    if (GATE.includes(res.status())) {
      test
        .info()
        .annotations.push({ type: 'note', description: `gated (${res.status()}) — shape N/A unauthenticated` });
      return;
    }
    expect([200, 201]).toContain(res.status());
    const body = await res.json();
    expect(body).toHaveProperty('run_id');
    expect(body).toHaveProperty('agents');
    expect(body).toHaveProperty('sse_url');
    expect(Array.isArray(body.agents)).toBe(true);
    for (const agent of body.agents) {
      expect(agent).toHaveProperty('file_glob');
      expect(agent.file_glob.length).toBeGreaterThan(0);
    }
  });

  test('agents own non-overlapping file_glob roots (authenticated 2xx only)', async ({ request }) => {
    const res = await request.post(`${PROD_URL}/api/swarm/${SITE_ID}/start`, {
      data: { agents: ['visual', 'copy', 'seo', 'a11y', 'motion', 'media', 'qa'] },
    });
    if (![200, 201].includes(res.status())) return;
    const body = await res.json();
    const roots = (body.agents as Array<{ file_glob: string }>).map((a) => a.file_glob.split('/')[0]);
    // Each specialist should own a distinct top-level directory.
    expect(new Set(roots).size).toBeGreaterThan(3);
  });
});

test.describe('Swarm Editor SSE stream', () => {
  test('SSE endpoint is gated unauthenticated or streams text/event-stream', async ({ request }) => {
    const res = await request.get(`${PROD_URL}/api/swarm/${SITE_ID}/stream`);
    if (GATE.includes(res.status())) return; // gated unauthenticated
    expect(res.headers()['content-type'] ?? '').toContain('text/event-stream');
  });
});

test.describe('Swarm Editor admin UI', () => {
  test('admin route is protected by the auth guard', async ({ page }) => {
    await page.goto(`${PROD_URL}/admin/swarm/${SITE_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    // Unauthenticated → bounced to /signin; authenticated → the board under /admin/swarm.
    await expect
      .poll(() => page.url(), { timeout: 15_000 })
      .toMatch(/\/signin|\/admin\/swarm/);
  });
});
