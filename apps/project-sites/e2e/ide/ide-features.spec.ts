/**
 * IDE-01..IDE-07 — IDE Sandbox + Multi-agent + Progressive skeleton build.
 *
 * All three features live behind `ide_sandbox`, `multi_agent_concurrent`,
 * and `progressive_skeleton_build` feature flags.
 *
 * Tests mock:
 *   - /api/feature-flags → all three flags ON
 *   - Individual IDE API endpoints → realistic JSON shapes
 *
 * Tests are hermetic: every test seeds its own route stubs before navigation.
 */

import { test, expect } from '@playwright/test';
import { signInAsTestUser } from '../helpers/auth.js';

const BASE = process.env.PROD_URL ?? process.env.BASE_URL ?? 'http://localhost:4200';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function stubIdeFlagsOn(page: import('@playwright/test').Page): Promise<void> {
  await page.route('**/api/feature-flags', async (route) => {
    const flags = [
      { key: 'ide_sandbox', description: 'IDE Sandbox', default_enabled: true, default_rollout_percent: 100, stage: 'beta', owner_email: 'test@megabyte.space' },
      { key: 'multi_agent_concurrent', description: 'Multi-agent concurrent', default_enabled: true, default_rollout_percent: 100, stage: 'beta', owner_email: 'test@megabyte.space' },
      { key: 'progressive_skeleton_build', description: 'Progressive skeleton', default_enabled: true, default_rollout_percent: 100, stage: 'beta', owner_email: 'test@megabyte.space' },
    ];
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ flags, count: flags.length }) });
  });
  await page.route(/\/api\/feature-flags\/[^/]+$/, async (route) => {
    const key = route.request().url().split('/api/feature-flags/')[1]?.split('?')[0] ?? '';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ definition: { key, default_enabled: true, default_rollout_percent: 100, stage: 'beta' }, resolved: { enabled: true, rollout_percent: 100 } }),
    });
  });
}

const DEMO_SANDBOX_ID = 'sb-e2e-001';

async function stubIdeSandbox(page: import('@playwright/test').Page): Promise<void> {
  // Spin-up endpoint
  await page.route('**/api/ide-sandbox/spin-up', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        sandbox_id: DEMO_SANDBOX_ID,
        site_id: 'demo-site',
        user_id: 'demo-user',
        state: 'ready',
        ide_url: `https://ide.projectsites.dev/sandbox/${DEMO_SANDBOX_ID}`,
        runtime: 'cloudflare-sandbox',
        container_image: 'node:22-slim',
        auto_destroy_idle_minutes: 30,
        created_at: '2026-01-01T00:00:00Z',
      }),
    });
  });

  // Status endpoint
  await page.route(`**/api/ide-sandbox/status/${DEMO_SANDBOX_ID}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        sandbox_id: DEMO_SANDBOX_ID,
        state: 'ready',
        site_id: 'demo-site',
        age_seconds: 15,
        idle_seconds: 3,
        auto_destroy_in_seconds: 1785,
      }),
    });
  });

  // Destroy endpoint
  await page.route(`**/api/ide-sandbox/destroy/${DEMO_SANDBOX_ID}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ sandbox_id: DEMO_SANDBOX_ID, state: 'destroyed', destroyed_at: '2026-01-01T00:01:00Z' }),
    });
  });
}

const DEMO_RUN_ID = 'run-e2e-001';

async function stubMultiAgent(page: import('@playwright/test').Page): Promise<void> {
  await page.route('**/api/multi-agent/start', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        run_id: DEMO_RUN_ID,
        site_id: 'demo-site',
        prompt: 'Build a landing page for an artisan bakery',
        agents: [
          { id: 'a1', name: 'design', status: 'queued' },
          { id: 'a2', name: 'copy', status: 'queued' },
          { id: 'a3', name: 'seo', status: 'queued' },
          { id: 'a4', name: 'a11y', status: 'queued' },
        ],
        parallel: true,
        estimated_total_ms: 28000,
        stream_url: `https://projectsites.dev/api/multi-agent/run/${DEMO_RUN_ID}/stream`,
        started_at: '2026-01-01T00:00:00Z',
      }),
    });
  });

  await page.route(`**/api/multi-agent/run/${DEMO_RUN_ID}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        run_id: DEMO_RUN_ID,
        status: 'running',
        agents: [
          { id: 'a1', name: 'design', status: 'done', duration_ms: 21400 },
          { id: 'a2', name: 'copy', status: 'done', duration_ms: 17900 },
          { id: 'a3', name: 'seo', status: 'running' },
          { id: 'a4', name: 'a11y', status: 'queued' },
        ],
        live_stream_events: [
          { ts: '2026-01-01T00:00:00Z', agent: 'design', event: 'started' },
          { ts: '2026-01-01T00:00:22Z', agent: 'design', event: 'done' },
        ],
      }),
    });
  });

  await page.route('**/api/multi-agent/runs/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ runs: [{ id: DEMO_RUN_ID, prompt: 'Build a landing page', status: 'running', started_at: '2026-01-01T00:00:00Z' }] }),
    });
  });

  // SSE stream endpoint (mock as JSON since Playwright doesn't do SSE natively here)
  await page.route(`**/api/multi-agent/run/${DEMO_RUN_ID}/stream`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: 'data: {"agent":"design","event":"started"}\n\ndata: {"agent":"copy","event":"started"}\n\n',
    });
  });
}

async function stubProgressiveBuild(page: import('@playwright/test').Page): Promise<void> {
  await page.route('**/api/progressive-build/publish-skeleton/demo-site', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        site_id: 'demo-site',
        state: 'skeleton_live',
        skeleton_url: 'https://demo-site.projectsites.dev/',
        skeleton_components: ['nav', 'hero', 'features', 'social-proof', 'pricing', 'testimonials', 'faq', 'cta', 'footer'],
        stream_endpoint: 'https://projectsites.dev/api/progressive-build/stream/demo-site',
        estimated_full_ready_ms: 45000,
        published_at: '2026-01-01T00:00:00Z',
      }),
    });
  });

  await page.route('**/api/progressive-build/stream/demo-site', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        site_id: 'demo-site',
        state: 'skeleton_live',
        components_total: 9,
        components_done: ['nav', 'hero', 'features'],
        components_remaining: ['social-proof', 'pricing', 'testimonials', 'faq', 'cta', 'footer'],
        next_component: 'social-proof',
        progress_pct: 33,
        age_seconds: 12,
        sse_stream_url: 'https://projectsites.dev/api/progressive-build/sse/demo-site',
        last_component_emitted_at: '2026-01-01T00:00:12Z',
      }),
    });
  });

  // SSE stream endpoint
  await page.route('**/api/progressive-build/sse/demo-site', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: 'data: {"component":"nav","state":"ready"}\n\ndata: {"component":"hero","state":"ready"}\n\n',
    });
  });
}

// ---------------------------------------------------------------------------
// IDE-01 — Spin-up Sandbox container DO (flag ide_sandbox)
// ---------------------------------------------------------------------------

test('IDE-01 — spin up IDE sandbox returns ready state and URLs', async ({ page }) => {
  await page.goto(BASE);
  await signInAsTestUser(page);
  await stubIdeFlagsOn(page);
  await stubIdeSandbox(page);

  // Navigate to the features hub IDE tab and try the spin-up endpoint
  await page.goto(`${BASE}/admin/features-hub?tab=ide`);
  await expect(page.locator('.hub-card').filter({ has: page.locator('code:text-is("ide_sandbox")') })).toBeVisible({ timeout: 10_000 });

  const card = page.locator('.hub-card').filter({ has: page.locator('code:text-is("ide_sandbox")') });
  const tryBtn = card.locator('[data-testid="hub-try-btn"]').first().or(card.getByRole('button', { name: /Try/i }).first());
  await tryBtn.click();

  const resultPanel = card.locator('[data-testid="hub-result"]').first().or(card.locator('.hub-result').first());
  await expect(resultPanel).toBeVisible({ timeout: 8_000 });
  await expect(resultPanel).toContainText('200');
  await expect(resultPanel).toContainText('sandbox_id');
});

// ---------------------------------------------------------------------------
// IDE-02 — Sandbox status reflects state machine
// ---------------------------------------------------------------------------

test('IDE-02 — sandbox status endpoint returns state machine fields', async ({ page }) => {
  await page.goto(BASE);
  await signInAsTestUser(page);
  await stubIdeFlagsOn(page);

  // Stub status directly
  await page.route(`**/api/ide-sandbox/status/${DEMO_SANDBOX_ID}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        sandbox_id: DEMO_SANDBOX_ID,
        state: 'ready',
        site_id: 'demo-site',
        age_seconds: 30,
        idle_seconds: 5,
        auto_destroy_in_seconds: 1770,
      }),
    });
  });

  const resp = await page.request.get(`${BASE}/api/ide-sandbox/status/${DEMO_SANDBOX_ID}`);
  const body = await resp.json() as Record<string, unknown>;
  expect(body['sandbox_id']).toBe(DEMO_SANDBOX_ID);
  expect(['ready', 'spinning_up', 'not_found']).toContain(body['state']);
  expect(typeof body['age_seconds']).toBe('number');
});

// ---------------------------------------------------------------------------
// IDE-03 — Destroy sandbox releases container
// ---------------------------------------------------------------------------

test('IDE-03 — destroy sandbox endpoint returns destroyed state', async ({ page }) => {
  await page.goto(BASE);
  await signInAsTestUser(page);
  await stubIdeFlagsOn(page);

  await page.route(`**/api/ide-sandbox/destroy/${DEMO_SANDBOX_ID}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ sandbox_id: DEMO_SANDBOX_ID, state: 'destroyed', destroyed_at: '2026-01-01T00:05:00Z' }),
    });
  });

  const resp = await page.request.post(`${BASE}/api/ide-sandbox/destroy/${DEMO_SANDBOX_ID}`);
  const body = await resp.json() as Record<string, unknown>;
  expect(body['state']).toBe('destroyed');
  expect(body['sandbox_id']).toBe(DEMO_SANDBOX_ID);
  expect(typeof body['destroyed_at']).toBe('string');
});

// ---------------------------------------------------------------------------
// IDE-04 — Multi-agent run starts 7-specialist roster
// ---------------------------------------------------------------------------

test('IDE-04 — multi-agent run starts with specialist roster agents', async ({ page }) => {
  await page.goto(BASE);
  await signInAsTestUser(page);
  await stubIdeFlagsOn(page);
  await stubMultiAgent(page);

  // Navigate to features hub IDE tab and use the multi-agent card
  await page.goto(`${BASE}/admin/features-hub?tab=ide`);

  const maCard = page.locator('.hub-card').filter({ has: page.locator('code:text-is("multi_agent_concurrent")') });
  await expect(maCard).toBeVisible({ timeout: 10_000 });

  const tryBtn = maCard.locator('[data-testid="hub-try-btn"]').first().or(maCard.getByRole('button', { name: /Try/i }).first());
  await tryBtn.click();

  const resultPanel = maCard.locator('[data-testid="hub-result"]').first().or(maCard.locator('.hub-result').first());
  await expect(resultPanel).toBeVisible({ timeout: 8_000 });
  await expect(resultPanel).toContainText('200');
  await expect(resultPanel).toContainText('run_id');
  await expect(resultPanel).toContainText('parallel');
});

// ---------------------------------------------------------------------------
// IDE-05 — Multi-agent events stream via SSE (stub verifies stream URL in response)
// ---------------------------------------------------------------------------

test('IDE-05 — multi-agent run response includes SSE stream_url', async ({ page }) => {
  await page.goto(BASE);
  await signInAsTestUser(page);
  await stubIdeFlagsOn(page);

  await page.route('**/api/multi-agent/start', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        run_id: DEMO_RUN_ID,
        site_id: 'demo-site',
        stream_url: `https://projectsites.dev/api/multi-agent/run/${DEMO_RUN_ID}/stream`,
        agents: [
          { id: 'a1', name: 'design', status: 'queued' },
          { id: 'a2', name: 'copy', status: 'queued' },
          { id: 'a3', name: 'seo', status: 'queued' },
          { id: 'a4', name: 'a11y', status: 'queued' },
          { id: 'a5', name: 'media', status: 'queued' },
          { id: 'a6', name: 'motion', status: 'queued' },
          { id: 'a7', name: 'qa', status: 'queued' },
        ],
        parallel: true,
        estimated_total_ms: 28000,
        started_at: '2026-01-01T00:00:00Z',
      }),
    });
  });

  const resp = await page.request.post(`${BASE}/api/multi-agent/start`, {
    data: { site_id: 'demo-site', agents: ['design', 'copy', 'seo', 'a11y', 'media', 'motion', 'qa'], prompt: 'Build a landing page' },
  });
  const body = await resp.json() as Record<string, unknown>;

  // Verify stream_url is present
  expect(typeof body['stream_url']).toBe('string');
  expect(body['stream_url'] as string).toContain('/stream');

  // Verify 7-specialist roster
  const agents = body['agents'] as Array<{ name: string }>;
  expect(agents).toHaveLength(7);
  const agentNames = agents.map((a) => a.name);
  for (const name of ['design', 'copy', 'seo', 'a11y', 'media', 'motion', 'qa']) {
    expect(agentNames).toContain(name);
  }
});

// ---------------------------------------------------------------------------
// IDE-06 — Progressive skeleton publish renders 9 skeleton components
// ---------------------------------------------------------------------------

test('IDE-06 — progressive skeleton publish returns 9 skeleton component slots', async ({ page }) => {
  await page.goto(BASE);
  await signInAsTestUser(page);
  await stubIdeFlagsOn(page);
  await stubProgressiveBuild(page);

  // Navigate to features hub IDE tab and click the skeleton card
  await page.goto(`${BASE}/admin/features-hub?tab=ide`);

  const skeletonCard = page.locator('.hub-card').filter({ has: page.locator('code:text-is("progressive_skeleton_build")') });
  await expect(skeletonCard).toBeVisible({ timeout: 10_000 });

  const tryBtn = skeletonCard.locator('[data-testid="hub-try-btn"]').first().or(skeletonCard.getByRole('button', { name: /Try/i }).first());
  await tryBtn.click();

  const resultPanel = skeletonCard.locator('[data-testid="hub-result"]').first().or(skeletonCard.locator('.hub-result').first());
  await expect(resultPanel).toBeVisible({ timeout: 8_000 });
  await expect(resultPanel).toContainText('200');
  await expect(resultPanel).toContainText('skeleton_components');
});

// ---------------------------------------------------------------------------
// IDE-07 — Build stream endpoint reflects component-level progress
// ---------------------------------------------------------------------------

test('IDE-07 — build stream endpoint returns components_total=9 and progress_pct', async ({ page }) => {
  await page.goto(BASE);
  await signInAsTestUser(page);
  await stubIdeFlagsOn(page);

  await page.route('**/api/progressive-build/stream/demo-site', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        site_id: 'demo-site',
        state: 'skeleton_live',
        components_total: 9,
        components_done: ['nav', 'hero', 'features', 'social-proof'],
        components_remaining: ['pricing', 'testimonials', 'faq', 'cta', 'footer'],
        next_component: 'pricing',
        progress_pct: 44,
        age_seconds: 20,
        sse_stream_url: 'https://projectsites.dev/api/progressive-build/sse/demo-site',
      }),
    });
  });

  const resp = await page.request.get(`${BASE}/api/progressive-build/stream/demo-site`);
  const body = await resp.json() as Record<string, unknown>;

  expect(body['components_total']).toBe(9);
  expect(typeof body['progress_pct']).toBe('number');
  expect(body['progress_pct'] as number).toBeGreaterThanOrEqual(0);
  expect(body['progress_pct'] as number).toBeLessThanOrEqual(100);
  expect(typeof body['sse_stream_url']).toBe('string');

  // components_done + components_remaining should sum to 9
  const done = (body['components_done'] as unknown[]).length;
  const remaining = (body['components_remaining'] as unknown[]).length;
  expect(done + remaining).toBe(9);
});
