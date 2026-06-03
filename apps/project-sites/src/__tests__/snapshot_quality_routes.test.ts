/**
 * Route coverage for the snapshot-quality matrix (convergence r44).
 *
 * Exercises every handler in {@link snapshotQuality} end-to-end through the
 * real Hono app + the shared {@link errorHandler}, mocking only the boundaries
 * (D1, the `SNAPSHOT_QUALITY_WORKFLOW` binding, R2 `SITES_BUCKET`).
 *
 * Handlers covered:
 *  - POST `/api/sites/:siteId/snapshots/:snapshotId/capture`
 *  - GET  `/api/sites/:siteId/snapshots/:snapshotId/metrics`
 *  - GET  `/api/sites/:siteId/snapshots/metrics`
 *  - GET  `/api/sites/:siteId/snapshots/:snapshotId/screenshot.png`
 *
 * Cross-cutting: auth (401), org-scoped 404 non-leak, Zod 400 on the capture
 * body, 503 workflow-unavailable degradation, workflow dispatch on success,
 * R2 streaming + cache headers, and resilience on the empty/pending paths.
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { errorHandler } from '../middleware/error_handler.js';
import { snapshotQuality } from '../routes/snapshot_quality.js';

// ─── Boundary mocks ──────────────────────────────────────────────────────────

/** A D1 prepared-statement stub that dispatches by SQL keyword to a result map. */
interface D1Results {
  /** Result for the `resolveSnapshot` JOIN (snapshot+site). */
  snapshot?: unknown;
  /** Result for the `SELECT id FROM sites` org check (grid endpoint). */
  site?: unknown;
  /** Result for the single-snapshot metrics `SELECT * FROM snapshot_metrics`. */
  metricsFirst?: unknown;
  /** Result for the screenshot key `SELECT screenshot_r2_key`. */
  screenshotKeyFirst?: unknown;
  /** Result for the grid `.all()` over snapshot_metrics. */
  metricsAll?: unknown[];
}

/**
 * Build a D1Database mock. Each `prepare(sql)` returns a chainable statement
 * whose `.first()` / `.all()` resolves based on which SQL it received, so a
 * single env can serve all four handlers without leaking cross-query state.
 */
function makeDb(results: D1Results = {}) {
  const prepare = jest.fn((sql: string) => {
    const stmt = {
      _sql: sql,
      bind: jest.fn(() => stmt),
      first: jest.fn(async () => {
        if (/FROM site_snapshots/.test(sql)) return results.snapshot ?? null;
        if (/SELECT id FROM sites/.test(sql)) return results.site ?? null;
        if (/SELECT screenshot_r2_key/.test(sql)) return results.screenshotKeyFirst ?? null;
        if (/FROM snapshot_metrics/.test(sql)) return results.metricsFirst ?? null;
        return null;
      }),
      all: jest.fn(async () => ({ results: results.metricsAll ?? [] })),
    };
    return stmt;
  });
  return { prepare, _prepare: prepare } as unknown as D1Database & { _prepare: jest.Mock };
}

/** Workflow binding mock; `.create()` resolves to a fake instance handle. */
function makeWorkflow() {
  return { create: jest.fn(async () => ({ id: 'wf-instance-1' })) };
}

/** R2 bucket mock; `.get(key)` returns an object stub or null when missing. */
function makeBucket(obj: { body: unknown; contentType?: string } | null) {
  return {
    get: jest.fn(async () =>
      obj
        ? { body: obj.body, httpMetadata: { contentType: obj.contentType } }
        : null,
    ),
  };
}

const SNAP_ROW = {
  id: 'snap-1',
  site_id: 'site-1',
  snapshot_name: 'initial',
  build_version: 'v1',
  slug: 'vitos-salon',
};

function makeEnv(overrides: Partial<Record<string, unknown>> = {}): Env {
  return {
    ENVIRONMENT: 'test',
    DB: makeDb(),
    SNAPSHOT_QUALITY_WORKFLOW: makeWorkflow(),
    SITES_BUCKET: makeBucket(null),
    ...overrides,
  } as unknown as Env;
}

// ─── App harness ─────────────────────────────────────────────────────────────

function makeApp(vars: Partial<Variables> = {}) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.onError(errorHandler);
  app.use('*', async (c, next) => {
    if (vars.userId) c.set('userId', vars.userId);
    if (vars.orgId) c.set('orgId', vars.orgId);
    if (vars.requestId) c.set('requestId', vars.requestId);
    await next();
  });
  app.route('/', snapshotQuality);
  return app;
}

function makeCtx(): ExecutionContext {
  return {
    waitUntil: (_p: Promise<unknown>) => {},
    passThroughOnException: () => {},
  } as unknown as ExecutionContext;
}

function req(
  app: Hono<{ Bindings: Env; Variables: Variables }>,
  path: string,
  env: Env,
  init?: RequestInit,
) {
  return app.request(path, init, env, makeCtx());
}

const AUTH: Partial<Variables> = { userId: 'user-1', orgId: 'org-1', requestId: 'req-1' };
const CAPTURE_PATH = '/api/sites/site-1/snapshots/snap-1/capture';
const METRICS_PATH = '/api/sites/site-1/snapshots/snap-1/metrics';
const GRID_PATH = '/api/sites/site-1/snapshots/metrics';
const SHOT_PATH = '/api/sites/site-1/snapshots/snap-1/screenshot.png';

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── POST capture ──────────────────────────────────────────────────────────

describe('POST /api/sites/:siteId/snapshots/:snapshotId/capture', () => {
  it('returns 401 when unauthenticated', async () => {
    const env = makeEnv();
    const res = await req(makeApp(), CAPTURE_PATH, env, { method: 'POST' });
    expect(res.status).toBe(401);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe('UNAUTHORIZED');
    expect((env.SNAPSHOT_QUALITY_WORKFLOW as unknown as { create: jest.Mock }).create)
      .not.toHaveBeenCalled();
  });

  it('returns 400 when the capture body fails Zod (unknown key / wrong type)', async () => {
    const env = makeEnv({ DB: makeDb({ snapshot: SNAP_ROW }) });
    const res = await req(makeApp(AUTH), CAPTURE_PATH, env, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force: 'yes-please' }), // force must be boolean
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe('BAD_REQUEST');
  });

  it('returns 404 (non-leak) when the snapshot is cross-org / missing', async () => {
    const env = makeEnv({ DB: makeDb({ snapshot: null }) });
    const res = await req(makeApp(AUTH), CAPTURE_PATH, env, { method: 'POST' });
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe('NOT_FOUND');
    expect((env.SNAPSHOT_QUALITY_WORKFLOW as unknown as { create: jest.Mock }).create)
      .not.toHaveBeenCalled();
  });

  it('returns 503 when the workflow binding is missing', async () => {
    const env = makeEnv({
      DB: makeDb({ snapshot: SNAP_ROW }),
      SNAPSHOT_QUALITY_WORKFLOW: undefined,
    });
    const res = await req(makeApp(AUTH), CAPTURE_PATH, env, { method: 'POST' });
    expect(res.status).toBe(503);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe('SNAPSHOT_WORKFLOW_UNAVAILABLE');
  });

  it('dispatches the workflow and returns 200 { status, metrics_id } on success', async () => {
    const env = makeEnv({ DB: makeDb({ snapshot: SNAP_ROW }) });
    const res = await req(makeApp(AUTH), CAPTURE_PATH, env, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force: true }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { status: string; metrics_id: string };
    expect(json.status).toBe('capturing');
    expect(typeof json.metrics_id).toBe('string');

    const create = (env.SNAPSHOT_QUALITY_WORKFLOW as unknown as { create: jest.Mock }).create;
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0]).toMatchObject({
      params: {
        snapshotId: 'snap-1',
        siteId: 'site-1',
        slug: 'vitos-salon',
        capturedVia: 'manual',
      },
    });
  });

  it('accepts an empty (no-JSON) body as valid', async () => {
    const env = makeEnv({ DB: makeDb({ snapshot: SNAP_ROW }) });
    const res = await req(makeApp(AUTH), CAPTURE_PATH, env, { method: 'POST' });
    expect(res.status).toBe(200);
    expect((env.SNAPSHOT_QUALITY_WORKFLOW as unknown as { create: jest.Mock }).create)
      .toHaveBeenCalledTimes(1);
  });
});

// ─── GET single metrics ──────────────────────────────────────────────────────

describe('GET /api/sites/:siteId/snapshots/:snapshotId/metrics', () => {
  it('returns 401 when unauthenticated', async () => {
    const res = await req(makeApp(), METRICS_PATH, makeEnv());
    expect(res.status).toBe(401);
  });

  it('returns 404 when the snapshot is cross-org / missing', async () => {
    const env = makeEnv({ DB: makeDb({ snapshot: null }) });
    const res = await req(makeApp(AUTH), METRICS_PATH, env);
    expect(res.status).toBe(404);
  });

  it('returns 200 { data: null, status: pending } when no metrics row exists yet', async () => {
    const env = makeEnv({ DB: makeDb({ snapshot: SNAP_ROW, metricsFirst: null }) });
    const res = await req(makeApp(AUTH), METRICS_PATH, env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: unknown; status?: string };
    expect(json.data).toBeNull();
    expect(json.status).toBe('pending');
  });

  it('returns the metrics row + proxy screenshot_url when a screenshot key exists', async () => {
    const env = makeEnv({
      DB: makeDb({
        snapshot: SNAP_ROW,
        metricsFirst: {
          id: 'm-1',
          snapshot_id: 'snap-1',
          lh_performance: 98,
          screenshot_r2_key: 'sites/vitos-salon/v1/shot.png',
        },
      }),
    });
    const res = await req(makeApp(AUTH), METRICS_PATH, env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: Record<string, unknown> };
    expect(json.data['lh_performance']).toBe(98);
    expect(json.data['screenshot_url']).toBe(
      '/api/sites/site-1/snapshots/snap-1/screenshot.png',
    );
  });

  it('returns a null screenshot_url when the metrics row has no R2 key', async () => {
    const env = makeEnv({
      DB: makeDb({
        snapshot: SNAP_ROW,
        metricsFirst: { id: 'm-1', snapshot_id: 'snap-1', screenshot_r2_key: null },
      }),
    });
    const res = await req(makeApp(AUTH), METRICS_PATH, env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: Record<string, unknown> };
    expect(json.data['screenshot_url']).toBeNull();
  });
});

// ─── GET grid metrics ────────────────────────────────────────────────────────

describe('GET /api/sites/:siteId/snapshots/metrics (grid)', () => {
  it('returns 401 when unauthenticated', async () => {
    const res = await req(makeApp(), GRID_PATH, makeEnv());
    expect(res.status).toBe(401);
  });

  it('returns 404 when the site is cross-org / missing', async () => {
    const env = makeEnv({ DB: makeDb({ site: null }) });
    const res = await req(makeApp(AUTH), GRID_PATH, env);
    expect(res.status).toBe(404);
  });

  it('returns 200 with an empty data array when the site has no metrics', async () => {
    const env = makeEnv({ DB: makeDb({ site: { id: 'site-1' }, metricsAll: [] }) });
    const res = await req(makeApp(AUTH), GRID_PATH, env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: unknown[] };
    expect(json.data).toEqual([]);
  });

  it('enriches every row with a screenshot_url (proxy or null)', async () => {
    const env = makeEnv({
      DB: makeDb({
        site: { id: 'site-1' },
        metricsAll: [
          { snapshot_id: 'snap-1', screenshot_r2_key: 'sites/x/v1/a.png', lh_seo: 100 },
          { snapshot_id: 'snap-2', screenshot_r2_key: null, lh_seo: 90 },
        ],
      }),
    });
    const res = await req(makeApp(AUTH), GRID_PATH, env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: Array<Record<string, unknown>> };
    expect(json.data).toHaveLength(2);
    expect(json.data[0]['screenshot_url']).toBe(
      '/api/sites/site-1/snapshots/snap-1/screenshot.png',
    );
    expect(json.data[1]['screenshot_url']).toBeNull();
  });
});

// ─── GET screenshot.png ──────────────────────────────────────────────────────

describe('GET /api/sites/:siteId/snapshots/:snapshotId/screenshot.png', () => {
  it('returns 401 when unauthenticated', async () => {
    const res = await req(makeApp(), SHOT_PATH, makeEnv());
    expect(res.status).toBe(401);
  });

  it('returns 404 when the snapshot is cross-org / missing', async () => {
    const env = makeEnv({ DB: makeDb({ snapshot: null }) });
    const res = await req(makeApp(AUTH), SHOT_PATH, env);
    expect(res.status).toBe(404);
  });

  it('returns 404 when the screenshot has not been captured (no R2 key)', async () => {
    const env = makeEnv({
      DB: makeDb({ snapshot: SNAP_ROW, screenshotKeyFirst: { screenshot_r2_key: null } }),
    });
    const res = await req(makeApp(AUTH), SHOT_PATH, env);
    expect(res.status).toBe(404);
  });

  it('returns 404 when the R2 object is missing from storage', async () => {
    const env = makeEnv({
      DB: makeDb({
        snapshot: SNAP_ROW,
        screenshotKeyFirst: { screenshot_r2_key: 'sites/x/v1/a.png' },
      }),
      SITES_BUCKET: makeBucket(null),
    });
    const res = await req(makeApp(AUTH), SHOT_PATH, env);
    expect(res.status).toBe(404);
  });

  it('streams the PNG with content-type + private cache header on success', async () => {
    const env = makeEnv({
      DB: makeDb({
        snapshot: SNAP_ROW,
        screenshotKeyFirst: { screenshot_r2_key: 'sites/x/v1/a.png' },
      }),
      SITES_BUCKET: makeBucket({ body: 'PNGDATA', contentType: 'image/png' }),
    });
    const res = await req(makeApp(AUTH), SHOT_PATH, env);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=3600');
    expect(await res.text()).toBe('PNGDATA');
  });

  it('falls back to image/png when R2 has no stored content-type', async () => {
    const env = makeEnv({
      DB: makeDb({
        snapshot: SNAP_ROW,
        screenshotKeyFirst: { screenshot_r2_key: 'sites/x/v1/a.png' },
      }),
      SITES_BUCKET: makeBucket({ body: 'X', contentType: undefined }),
    });
    const res = await req(makeApp(AUTH), SHOT_PATH, env);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
  });
});
