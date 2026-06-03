/**
 * Route coverage for `GET /api/social/analytics/aggregate` (convergence r43).
 *
 * Exercises the Pulse Analytics aggregate handler end-to-end through the real
 * Hono app + the shared {@link errorHandler}, mocking only the boundaries
 * (D1 via the `db` service, best-time-to-post AI via `social_ai`).
 *
 * Covers: auth 401 (missing user), 401 (missing org — non-leak), `days`
 * param clamping/validation, per-platform aggregation, best-post selection,
 * org scoping (only the caller's `org_id` reaches the query), the
 * best-time-to-post enrichment success + failure (graceful degradation),
 * and the empty-snapshot path.
 */

jest.mock('../services/db.js', () => ({
  dbQuery: jest.fn(),
  dbInsert: jest.fn(),
}));

jest.mock('../services/social_ai.js', () => ({
  bestTimeToPost: jest.fn(),
}));

// The route imports these at module load; they are not exercised by the
// aggregate handler but must resolve, so stub them to no-ops.
jest.mock('../services/social_account_ctx.js', () => ({
  loadAccount: jest.fn(),
}));

jest.mock('../services/social_publishers/index.js', () => ({
  getPublisher: jest.fn(),
}));

import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { errorHandler } from '../middleware/error_handler.js';
import { pulseAnalytics } from '../routes/pulse_analytics.js';
import { dbQuery } from '../services/db.js';
import { bestTimeToPost } from '../services/social_ai.js';

const mockDbQuery = dbQuery as unknown as jest.Mock;
const mockBestTimeToPost = bestTimeToPost as unknown as jest.Mock;

// ─── Boundary helpers ──────────────────────────────────────────────────────────

interface SnapshotRow {
  publish_id: string;
  post_id: string;
  platform: string;
  external_url: string | null;
  content: string;
  impressions: number | null;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  clicks: number | null;
  saves: number | null;
}

function row(overrides: Partial<SnapshotRow> = {}): SnapshotRow {
  return {
    publish_id: 'pub-1',
    post_id: 'post-1',
    platform: 'twitter',
    external_url: 'https://x.com/p/1',
    content: 'hello world',
    impressions: 100,
    reach: 80,
    likes: 5,
    comments: 1,
    shares: 2,
    clicks: 3,
    saves: 0,
    ...overrides,
  };
}

/** Make `dbQuery` resolve to the canonical `{ data, error }` envelope. */
function resolveSnapshots(rows: SnapshotRow[]) {
  mockDbQuery.mockResolvedValue({ data: rows, error: null });
}

function makeEnv(): Env {
  return {
    ENVIRONMENT: 'test',
    DB: {} as D1Database,
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
  app.route('/', pulseAnalytics);
  return app;
}

function makeCtx(): ExecutionContext {
  return {
    waitUntil: (_p: Promise<unknown>) => {},
    passThroughOnException: () => {},
  } as unknown as ExecutionContext;
}

function get(
  app: Hono<{ Bindings: Env; Variables: Variables }>,
  query: string,
  env: Env,
) {
  return app.request(`/api/social/analytics/aggregate${query}`, { method: 'GET' }, env, makeCtx());
}

const AUTH: Partial<Variables> = { userId: 'user-1', orgId: 'org-1', requestId: 'req-1' };

beforeEach(() => {
  jest.clearAllMocks();
  mockBestTimeToPost.mockResolvedValue([{ day: 1, hour: 9, confidence: 0.8 }]);
});

interface AggregateBody {
  window_days: number;
  generated_at: string;
  platform_totals: {
    platform: string;
    posts: number;
    impressions: number;
    reach: number;
    engagement: number;
  }[];
  best_posts: {
    post_id: string;
    publish_id: string;
    platform: string;
    external_url: string | null;
    content_preview: string;
    impressions: number;
    engagement: number;
  }[];
  best_times: { platform: string; slots: { day: number; hour: number; confidence: number }[] };
}

describe('GET /api/social/analytics/aggregate', () => {
  // ── Auth ────────────────────────────────────────────────────────────────
  it('returns 401 when the request is unauthenticated (no userId)', async () => {
    const env = makeEnv();
    const res = await get(makeApp(), '', env);
    expect(res.status).toBe(401);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe('UNAUTHORIZED');
    // Must short-circuit before touching D1 or the AI enrichment.
    expect(mockDbQuery).not.toHaveBeenCalled();
    expect(mockBestTimeToPost).not.toHaveBeenCalled();
  });

  it('returns 401 when the user has no org (non-leak — never 200 with cross-org data)', async () => {
    const env = makeEnv();
    const res = await get(makeApp({ userId: 'user-1', requestId: 'req-1' }), '', env);
    expect(res.status).toBe(401);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe('UNAUTHORIZED');
    expect(mockDbQuery).not.toHaveBeenCalled();
  });

  // ── Org scoping ───────────────────────────────────────────────────────────
  it("scopes the snapshot query to ONLY the caller's org_id", async () => {
    resolveSnapshots([]);
    const env = makeEnv();
    const res = await get(makeApp(AUTH), '', env);
    expect(res.status).toBe(200);
    // The only bind param passed to dbQuery is the caller's org id.
    expect(mockDbQuery).toHaveBeenCalledTimes(1);
    const params = mockDbQuery.mock.calls[0][2] as unknown[];
    expect(params).toEqual(['org-1']);
  });

  // ── days param validation / clamping ──────────────────────────────────────
  it('defaults the window to 30 days when no days param is given', async () => {
    resolveSnapshots([]);
    const env = makeEnv();
    const res = await get(makeApp(AUTH), '', env);
    const json = (await res.json()) as AggregateBody;
    expect(json.window_days).toBe(30);
  });

  it('honors a valid days param', async () => {
    resolveSnapshots([]);
    const env = makeEnv();
    const res = await get(makeApp(AUTH), '?days=7', env);
    const json = (await res.json()) as AggregateBody;
    expect(json.window_days).toBe(7);
  });

  it('falls back to 30 days on a non-numeric days param', async () => {
    resolveSnapshots([]);
    const env = makeEnv();
    const res = await get(makeApp(AUTH), '?days=abc', env);
    const json = (await res.json()) as AggregateBody;
    expect(json.window_days).toBe(30);
  });

  it('falls back to 30 days when days < 1', async () => {
    resolveSnapshots([]);
    const env = makeEnv();
    const res = await get(makeApp(AUTH), '?days=0', env);
    const json = (await res.json()) as AggregateBody;
    expect(json.window_days).toBe(30);
  });

  it('clamps an excessive days param to the 180-day ceiling', async () => {
    resolveSnapshots([]);
    const env = makeEnv();
    const res = await get(makeApp(AUTH), '?days=9999', env);
    const json = (await res.json()) as AggregateBody;
    expect(json.window_days).toBe(180);
  });

  // ── Empty state ───────────────────────────────────────────────────────────
  it('returns empty totals + posts and a default best-time platform when no snapshots exist', async () => {
    resolveSnapshots([]);
    const env = makeEnv();
    const res = await get(makeApp(AUTH), '', env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as AggregateBody;
    expect(json.platform_totals).toEqual([]);
    expect(json.best_posts).toEqual([]);
    // Top platform defaults to 'twitter' when there is nothing to rank.
    expect(json.best_times.platform).toBe('twitter');
    expect(mockBestTimeToPost).toHaveBeenCalledWith(env, { platform: 'twitter', org_id: 'org-1' });
    expect(typeof json.generated_at).toBe('string');
  });

  // ── Aggregation ───────────────────────────────────────────────────────────
  it('sums per-platform posts/impressions/reach/engagement across snapshots', async () => {
    resolveSnapshots([
      row({ publish_id: 'p1', platform: 'twitter', impressions: 100, reach: 80, likes: 5, comments: 1, shares: 2, clicks: 3, saves: 0 }),
      row({ publish_id: 'p2', platform: 'twitter', impressions: 50, reach: 40, likes: 1, comments: 1, shares: 0, clicks: 0, saves: 1 }),
      row({ publish_id: 'p3', platform: 'instagram', impressions: 200, reach: 150, likes: 10, comments: 4, shares: 1, clicks: 0, saves: 5 }),
    ]);
    const env = makeEnv();
    const res = await get(makeApp(AUTH), '', env);
    const json = (await res.json()) as AggregateBody;

    // Sorted by impressions desc → instagram (200) before twitter (150).
    expect(json.platform_totals.map((t) => t.platform)).toEqual(['instagram', 'twitter']);

    const tw = json.platform_totals.find((t) => t.platform === 'twitter')!;
    expect(tw.posts).toBe(2);
    expect(tw.impressions).toBe(150);
    expect(tw.reach).toBe(120);
    // engagement = (5+1+2+3+0) + (1+1+0+0+1) = 11 + 3 = 14
    expect(tw.engagement).toBe(14);

    const ig = json.platform_totals.find((t) => t.platform === 'instagram')!;
    expect(ig.posts).toBe(1);
    expect(ig.engagement).toBe(20); // 10+4+1+0+5
  });

  it('treats null metric columns as zero in the aggregation', async () => {
    resolveSnapshots([
      row({ publish_id: 'p1', platform: 'twitter', impressions: null, reach: null, likes: null, comments: null, shares: null, clicks: null, saves: null }),
    ]);
    const env = makeEnv();
    const res = await get(makeApp(AUTH), '', env);
    const json = (await res.json()) as AggregateBody;
    const tw = json.platform_totals[0];
    expect(tw.posts).toBe(1);
    expect(tw.impressions).toBe(0);
    expect(tw.reach).toBe(0);
    expect(tw.engagement).toBe(0);
  });

  // ── Best-post selection ─────────────────────────────────────────────────────
  it('ranks best posts by impressions + engagement*5 and caps at 5', async () => {
    const rows: SnapshotRow[] = [];
    // 7 distinct publishes with ascending impressions → only top 5 returned.
    for (let i = 1; i <= 7; i++) {
      rows.push(
        row({
          publish_id: `pub-${i}`,
          post_id: `post-${i}`,
          impressions: i * 10,
          likes: 0,
          comments: 0,
          shares: 0,
          clicks: 0,
          saves: 0,
        }),
      );
    }
    resolveSnapshots(rows);
    const env = makeEnv();
    const res = await get(makeApp(AUTH), '', env);
    const json = (await res.json()) as AggregateBody;
    expect(json.best_posts).toHaveLength(5);
    // Highest impressions (pub-7 → 70) ranks first.
    expect(json.best_posts[0].publish_id).toBe('pub-7');
    expect(json.best_posts[0].impressions).toBe(70);
    // The two lowest (pub-1, pub-2) are dropped by the slice(0,5).
    expect(json.best_posts.map((p) => p.publish_id)).not.toContain('pub-1');
  });

  it('keeps the highest-scoring snapshot per publish_id and truncates content_preview to 200 chars', async () => {
    const longContent = 'x'.repeat(300);
    resolveSnapshots([
      row({ publish_id: 'pub-1', content: longContent, impressions: 10, likes: 0, comments: 0, shares: 0, clicks: 0, saves: 0 }),
      row({ publish_id: 'pub-1', content: longContent, impressions: 90, likes: 0, comments: 0, shares: 0, clicks: 0, saves: 0 }),
    ]);
    const env = makeEnv();
    const res = await get(makeApp(AUTH), '', env);
    const json = (await res.json()) as AggregateBody;
    expect(json.best_posts).toHaveLength(1);
    // The 90-impression snapshot wins over the 10-impression one.
    expect(json.best_posts[0].impressions).toBe(90);
    expect(json.best_posts[0].content_preview).toHaveLength(200);
  });

  // ── Best-time enrichment ─────────────────────────────────────────────────────
  it('uses the top platform for the best-time enrichment and surfaces its slots', async () => {
    resolveSnapshots([
      row({ publish_id: 'p1', platform: 'twitter', impressions: 10 }),
      row({ publish_id: 'p2', platform: 'linkedin', impressions: 500 }),
    ]);
    mockBestTimeToPost.mockResolvedValue([{ day: 3, hour: 14, confidence: 0.9 }]);
    const env = makeEnv();
    const res = await get(makeApp(AUTH), '', env);
    const json = (await res.json()) as AggregateBody;
    // linkedin has the most impressions → it is the top platform.
    expect(json.best_times.platform).toBe('linkedin');
    expect(mockBestTimeToPost).toHaveBeenCalledWith(env, { platform: 'linkedin', org_id: 'org-1' });
    expect(json.best_times.slots).toEqual([{ day: 3, hour: 14, confidence: 0.9 }]);
  });

  it('degrades gracefully (empty slots) when the best-time enrichment throws', async () => {
    resolveSnapshots([row({ publish_id: 'p1', platform: 'twitter', impressions: 10 })]);
    mockBestTimeToPost.mockRejectedValue(new Error('AI gateway 503'));
    const env = makeEnv();
    const res = await get(makeApp(AUTH), '', env);
    // The whole endpoint still succeeds — best-time failure never crashes it.
    expect(res.status).toBe(200);
    const json = (await res.json()) as AggregateBody;
    expect(json.best_times.platform).toBe('twitter');
    expect(json.best_times.slots).toEqual([]);
    // Totals + posts are still computed despite the enrichment failure.
    expect(json.platform_totals).toHaveLength(1);
    expect(json.best_posts).toHaveLength(1);
  });

  // ── Error path ────────────────────────────────────────────────────────────
  it('returns a 500 envelope when the snapshot query throws', async () => {
    mockDbQuery.mockRejectedValue(new Error('D1 unavailable'));
    const env = makeEnv();
    const res = await get(makeApp(AUTH), '', env);
    expect(res.status).toBe(500);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe('INTERNAL_ERROR');
  });
});
