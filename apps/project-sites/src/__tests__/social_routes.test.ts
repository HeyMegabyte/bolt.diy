/**
 * Route coverage for `src/routes/social.ts` — Pulse Social accounts + posts +
 * publish controls + auto-pilot + RSS/OG preview (convergence r46).
 *
 * Exercises every handler end-to-end through the real Hono app, mocking only
 * the boundaries: the `db` service (D1 access), `social_auto_pilot` (LLM),
 * `rss_import`, `og_preview`, and `outbound_webhooks`. Covers auth (401),
 * org-scoping non-leak (404), Zod (400), the create/schedule/publish-now flow,
 * publish-row dispatch (success + per-account error), analytics aggregation,
 * the AI preview success + 502 failure, run-now generation, and feed imports.
 */

jest.mock('../services/db.js', () => ({
  dbQuery: jest.fn(),
  dbQueryOne: jest.fn(),
  dbInsert: jest.fn(),
  dbUpdate: jest.fn(),
  dbExecute: jest.fn(),
}));

jest.mock('../services/social_auto_pilot.js', () => ({
  DEFAULT_AUTO_PILOT_PROMPT: 'DEFAULT-PROMPT',
  loadAutoPilotConfig: jest.fn(),
  upsertAutoPilotConfig: jest.fn(),
  generateAutoPilotPostForNetwork: jest.fn(),
}));

jest.mock('../services/rss_import.js', () => ({
  parseRssFeed: jest.fn(),
  buildRssDraftRows: jest.fn(),
}));

jest.mock('../services/og_preview.js', () => ({
  parseOgTags: jest.fn(),
}));

jest.mock('../services/outbound_webhooks.js', () => ({
  isSafeWebhookUrl: jest.fn(),
}));

import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { errorHandler } from '../middleware/error_handler.js';
import { socialRoutes } from '../routes/social.js';
import {
  dbQuery,
  dbQueryOne,
  dbInsert,
  dbUpdate,
  dbExecute,
} from '../services/db.js';
import {
  loadAutoPilotConfig,
  upsertAutoPilotConfig,
  generateAutoPilotPostForNetwork,
} from '../services/social_auto_pilot.js';
import { parseRssFeed, buildRssDraftRows } from '../services/rss_import.js';
import { parseOgTags } from '../services/og_preview.js';
import { isSafeWebhookUrl } from '../services/outbound_webhooks.js';

const mDbQuery = dbQuery as unknown as jest.Mock;
const mDbQueryOne = dbQueryOne as unknown as jest.Mock;
const mDbInsert = dbInsert as unknown as jest.Mock;
const mDbUpdate = dbUpdate as unknown as jest.Mock;
const mDbExecute = dbExecute as unknown as jest.Mock;
const mLoadCfg = loadAutoPilotConfig as unknown as jest.Mock;
const mUpsertCfg = upsertAutoPilotConfig as unknown as jest.Mock;
const mGenPost = generateAutoPilotPostForNetwork as unknown as jest.Mock;
const mParseRss = parseRssFeed as unknown as jest.Mock;
const mBuildRss = buildRssDraftRows as unknown as jest.Mock;
const mParseOg = parseOgTags as unknown as jest.Mock;
const mSafeUrl = isSafeWebhookUrl as unknown as jest.Mock;

// ─── Harness ─────────────────────────────────────────────────────────────────

function makeEnv(): Env {
  return { ENVIRONMENT: 'test', DB: {} as D1Database, AI: {} } as unknown as Env;
}

/** App wired with the real error handler + a middleware that seeds auth vars. */
function makeApp(vars: Partial<Variables> = {}) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.onError(errorHandler);
  app.use('*', async (c, next) => {
    if (vars.userId) c.set('userId', vars.userId);
    if (vars.orgId) c.set('orgId', vars.orgId);
    if (vars.requestId) c.set('requestId', vars.requestId);
    await next();
  });
  app.route('/', socialRoutes);
  return app;
}

function makeCtx(): ExecutionContext {
  return {
    waitUntil: () => {},
    passThroughOnException: () => {},
  } as unknown as ExecutionContext;
}

const AUTH: Partial<Variables> = { userId: 'user-1', orgId: 'org-1', requestId: 'req-1' };
const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';

function req(
  app: Hono<{ Bindings: Env; Variables: Variables }>,
  path: string,
  method: string,
  env: Env,
  body?: unknown,
) {
  return app.request(
    path,
    {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    env,
    makeCtx(),
  );
}

async function jsonOf<T = Record<string, unknown>>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

beforeEach(() => {
  jest.clearAllMocks();
  // Sensible defaults so unrelated boundaries don't break a focused test.
  mDbQuery.mockResolvedValue({ data: [], error: null });
  mDbQueryOne.mockResolvedValue(null);
  mDbInsert.mockResolvedValue({ error: null });
  mDbUpdate.mockResolvedValue({ error: null, changes: 1 });
  mDbExecute.mockResolvedValue({ error: null, changes: 1 });
});

// ─── Accounts ────────────────────────────────────────────────────────────────

describe('GET /api/social/accounts', () => {
  it('401s when unauthenticated and never touches the DB', async () => {
    const env = makeEnv();
    const res = await req(makeApp(), '/api/social/accounts', 'GET', env);
    expect(res.status).toBe(401);
    expect((await jsonOf<{ error: { code: string } }>(res)).error.code).toBe('UNAUTHORIZED');
    expect(mDbQuery).not.toHaveBeenCalled();
  });

  it('lists org-scoped accounts', async () => {
    mDbQuery.mockResolvedValueOnce({ data: [{ id: UUID_A, platform: 'twitter' }], error: null });
    const env = makeEnv();
    const res = await req(makeApp(AUTH), '/api/social/accounts', 'GET', env);
    expect(res.status).toBe(200);
    expect((await jsonOf<{ data: unknown[] }>(res)).data).toHaveLength(1);
    // org_id is the sole bind param — confirms org scoping.
    expect(mDbQuery.mock.calls[0][2]).toEqual(['org-1']);
  });
});

describe('DELETE /api/social/accounts/:id', () => {
  it('401s when unauthenticated', async () => {
    const res = await req(makeApp(), `/api/social/accounts/${UUID_A}`, 'DELETE', makeEnv());
    expect(res.status).toBe(401);
  });

  it('disconnects (soft-deletes) an account', async () => {
    mDbExecute.mockResolvedValueOnce({ error: null, changes: 1 });
    const res = await req(makeApp(AUTH), `/api/social/accounts/${UUID_A}`, 'DELETE', makeEnv());
    expect(res.status).toBe(200);
    expect((await jsonOf<{ data: { deleted: boolean } }>(res)).data.deleted).toBe(true);
    expect(mDbExecute.mock.calls[0][2]).toEqual([UUID_A, 'org-1']);
  });

  it('404s (non-leak) when the account is not in the caller org', async () => {
    mDbExecute.mockResolvedValueOnce({ error: null, changes: 0 });
    const res = await req(makeApp(AUTH), `/api/social/accounts/${UUID_A}`, 'DELETE', makeEnv());
    expect(res.status).toBe(404);
    expect((await jsonOf<{ error: { code: string } }>(res)).error.code).toBe('NOT_FOUND');
  });

  it('500s when the DB write errors', async () => {
    mDbExecute.mockResolvedValueOnce({ error: 'boom', changes: 0 });
    const res = await req(makeApp(AUTH), `/api/social/accounts/${UUID_A}`, 'DELETE', makeEnv());
    expect(res.status).toBe(500);
  });
});

// ─── Posts: create ───────────────────────────────────────────────────────────

describe('POST /api/social/posts', () => {
  it('401s when unauthenticated', async () => {
    const res = await req(makeApp(), '/api/social/posts', 'POST', makeEnv(), {
      content: 'hi',
      account_ids: [UUID_A],
    });
    expect(res.status).toBe(401);
  });

  it('400s on Zod failure (empty account_ids)', async () => {
    const res = await req(makeApp(AUTH), '/api/social/posts', 'POST', makeEnv(), {
      content: 'hi',
      account_ids: [],
    });
    expect(res.status).toBe(400);
    expect(mDbInsert).not.toHaveBeenCalled();
  });

  it('400s when an account_id is not valid for the org', async () => {
    // Only one account comes back but two were requested.
    mDbQuery.mockResolvedValueOnce({ data: [{ id: UUID_A }], error: null });
    const res = await req(makeApp(AUTH), '/api/social/posts', 'POST', makeEnv(), {
      content: 'hi',
      account_ids: [UUID_A, UUID_B],
    });
    expect(res.status).toBe(400);
    expect((await jsonOf<{ error: { code: string } }>(res)).error.code).toBe('BAD_REQUEST');
    expect(mDbInsert).not.toHaveBeenCalled();
  });

  it('201 creates a draft when no schedule is given', async () => {
    mDbQuery.mockResolvedValueOnce({ data: [{ id: UUID_A }], error: null });
    const res = await req(makeApp(AUTH), '/api/social/posts', 'POST', makeEnv(), {
      content: 'hello world',
      account_ids: [UUID_A],
    });
    expect(res.status).toBe(201);
    const json = await jsonOf<{ data: { id: string; status: string } }>(res);
    expect(json.data.status).toBe('draft');
    expect(mDbInsert).toHaveBeenCalledTimes(1);
    expect(mDbInsert.mock.calls[0][1]).toBe('pulse_posts');
    expect(mDbInsert.mock.calls[0][2]).toMatchObject({ org_id: 'org-1', created_by: 'user-1', status: 'draft' });
  });

  it('201 creates a scheduled post when schedule_at is present', async () => {
    mDbQuery.mockResolvedValueOnce({ data: [{ id: UUID_A }], error: null });
    const res = await req(makeApp(AUTH), '/api/social/posts', 'POST', makeEnv(), {
      content: 'later',
      account_ids: [UUID_A],
      schedule_at: '2030-01-01T00:00:00.000Z',
    });
    expect(res.status).toBe(201);
    expect((await jsonOf<{ data: { status: string } }>(res)).data.status).toBe('scheduled');
  });

  it('500s when the insert fails', async () => {
    mDbQuery.mockResolvedValueOnce({ data: [{ id: UUID_A }], error: null });
    mDbInsert.mockResolvedValueOnce({ error: 'insert failed' });
    const res = await req(makeApp(AUTH), '/api/social/posts', 'POST', makeEnv(), {
      content: 'hi',
      account_ids: [UUID_A],
    });
    expect(res.status).toBe(500);
  });
});

// ─── Posts: list / get ─────────────────────────────────────────────────────────

describe('GET /api/social/posts', () => {
  it('401s when unauthenticated', async () => {
    const res = await req(makeApp(), '/api/social/posts', 'GET', makeEnv());
    expect(res.status).toBe(401);
  });

  it('lists posts org-scoped without a status filter', async () => {
    mDbQuery.mockResolvedValueOnce({ data: [{ id: UUID_A }], error: null });
    const res = await req(makeApp(AUTH), '/api/social/posts', 'GET', makeEnv());
    expect(res.status).toBe(200);
    // params = [org_id, limit] when no status filter.
    expect(mDbQuery.mock.calls[0][2]).toEqual(['org-1', 50]);
  });

  it('applies the status filter and caps the limit at 200', async () => {
    mDbQuery.mockResolvedValueOnce({ data: [], error: null });
    const res = await req(makeApp(AUTH), '/api/social/posts?status=scheduled&limit=999', 'GET', makeEnv());
    expect(res.status).toBe(200);
    expect(mDbQuery.mock.calls[0][2]).toEqual(['org-1', 'scheduled', 200]);
  });
});

describe('GET /api/social/posts/:id', () => {
  it('404s (non-leak) when the post is not in the org', async () => {
    mDbQueryOne.mockResolvedValueOnce(null);
    const res = await req(makeApp(AUTH), `/api/social/posts/${UUID_A}`, 'GET', makeEnv());
    expect(res.status).toBe(404);
  });

  it('returns the post when found', async () => {
    mDbQueryOne.mockResolvedValueOnce({ id: UUID_A, content: 'x' });
    const res = await req(makeApp(AUTH), `/api/social/posts/${UUID_A}`, 'GET', makeEnv());
    expect(res.status).toBe(200);
    expect((await jsonOf<{ data: { id: string } }>(res)).data.id).toBe(UUID_A);
  });
});

// ─── Posts: patch ──────────────────────────────────────────────────────────────

describe('PATCH /api/social/posts/:id', () => {
  it('401s when unauthenticated', async () => {
    const res = await req(makeApp(), `/api/social/posts/${UUID_A}`, 'PATCH', makeEnv(), { content: 'x' });
    expect(res.status).toBe(401);
  });

  it('400s on a Zod failure (content too long)', async () => {
    const res = await req(makeApp(AUTH), `/api/social/posts/${UUID_A}`, 'PATCH', makeEnv(), {
      content: 'x'.repeat(10001),
    });
    expect(res.status).toBe(400);
  });

  it('404s when the post is not in the org', async () => {
    mDbQueryOne.mockResolvedValueOnce(null);
    const res = await req(makeApp(AUTH), `/api/social/posts/${UUID_A}`, 'PATCH', makeEnv(), { content: 'x' });
    expect(res.status).toBe(404);
  });

  it('409s when the post is already published', async () => {
    mDbQueryOne.mockResolvedValueOnce({ status: 'published' });
    const res = await req(makeApp(AUTH), `/api/social/posts/${UUID_A}`, 'PATCH', makeEnv(), { content: 'x' });
    expect(res.status).toBe(409);
    expect((await jsonOf<{ error: { code: string } }>(res)).error.code).toBe('CONFLICT');
  });

  it('updates an editable draft', async () => {
    mDbQueryOne.mockResolvedValueOnce({ status: 'draft' });
    const res = await req(makeApp(AUTH), `/api/social/posts/${UUID_A}`, 'PATCH', makeEnv(), { content: 'edited' });
    expect(res.status).toBe(200);
    expect((await jsonOf<{ data: { updated: boolean } }>(res)).data.updated).toBe(true);
    expect(mDbUpdate).toHaveBeenCalledTimes(1);
  });

  it('is a no-op (updated:false) when no patchable fields are supplied', async () => {
    mDbQueryOne.mockResolvedValueOnce({ status: 'draft' });
    const res = await req(makeApp(AUTH), `/api/social/posts/${UUID_A}`, 'PATCH', makeEnv(), {});
    expect(res.status).toBe(200);
    expect((await jsonOf<{ data: { updated: boolean } }>(res)).data.updated).toBe(false);
    expect(mDbUpdate).not.toHaveBeenCalled();
  });
});

// ─── Posts: schedule / publish-now / delete ─────────────────────────────────────

describe('POST /api/social/posts/:id/schedule', () => {
  it('400s on a missing scheduled_at', async () => {
    const res = await req(makeApp(AUTH), `/api/social/posts/${UUID_A}/schedule`, 'POST', makeEnv(), {});
    expect(res.status).toBe(400);
  });

  it('schedules a draft', async () => {
    mDbExecute.mockResolvedValueOnce({ error: null, changes: 1 });
    const res = await req(makeApp(AUTH), `/api/social/posts/${UUID_A}/schedule`, 'POST', makeEnv(), {
      scheduled_at: '2030-01-01T00:00:00.000Z',
    });
    expect(res.status).toBe(200);
    expect((await jsonOf<{ data: { scheduled_at: string } }>(res)).data.scheduled_at).toBe(
      '2030-01-01T00:00:00.000Z',
    );
  });

  it('404s when nothing was updated (not found / not editable)', async () => {
    mDbExecute.mockResolvedValueOnce({ error: null, changes: 0 });
    const res = await req(makeApp(AUTH), `/api/social/posts/${UUID_A}/schedule`, 'POST', makeEnv(), {
      scheduled_at: '2030-01-01T00:00:00.000Z',
    });
    expect(res.status).toBe(404);
  });
});

describe('POST /api/social/posts/:id/publish-now', () => {
  it('401s when unauthenticated', async () => {
    const res = await req(makeApp(), `/api/social/posts/${UUID_A}/publish-now`, 'POST', makeEnv());
    expect(res.status).toBe(401);
  });

  it('schedules the post for ~now+1min', async () => {
    mDbExecute.mockResolvedValueOnce({ error: null, changes: 1 });
    const res = await req(makeApp(AUTH), `/api/social/posts/${UUID_A}/publish-now`, 'POST', makeEnv());
    expect(res.status).toBe(200);
    const json = await jsonOf<{ data: { scheduled_at: string } }>(res);
    expect(new Date(json.data.scheduled_at).getTime()).toBeGreaterThan(Date.now());
  });

  it('404s when nothing was updated', async () => {
    mDbExecute.mockResolvedValueOnce({ error: null, changes: 0 });
    const res = await req(makeApp(AUTH), `/api/social/posts/${UUID_A}/publish-now`, 'POST', makeEnv());
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/social/posts/:id', () => {
  it('soft-deletes a post', async () => {
    mDbExecute.mockResolvedValueOnce({ error: null, changes: 1 });
    const res = await req(makeApp(AUTH), `/api/social/posts/${UUID_A}`, 'DELETE', makeEnv());
    expect(res.status).toBe(200);
    expect((await jsonOf<{ data: { deleted: boolean } }>(res)).data.deleted).toBe(true);
  });

  it('404s when nothing matched', async () => {
    mDbExecute.mockResolvedValueOnce({ error: null, changes: 0 });
    const res = await req(makeApp(AUTH), `/api/social/posts/${UUID_A}`, 'DELETE', makeEnv());
    expect(res.status).toBe(404);
  });
});

// ─── Posts: publishes (dispatch rows) ────────────────────────────────────────────

describe('GET /api/social/posts/:id/publishes', () => {
  it('401s when unauthenticated', async () => {
    const res = await req(makeApp(), `/api/social/posts/${UUID_A}/publishes`, 'GET', makeEnv());
    expect(res.status).toBe(401);
  });

  it('404s when the post is not in the org', async () => {
    mDbQueryOne.mockResolvedValueOnce(null);
    const res = await req(makeApp(AUTH), `/api/social/posts/${UUID_A}/publishes`, 'GET', makeEnv());
    expect(res.status).toBe(404);
    // Must short-circuit before fetching publish rows.
    expect(mDbQuery).not.toHaveBeenCalled();
  });

  it('returns per-platform publish rows incl. a succeeded + an errored dispatch', async () => {
    mDbQueryOne.mockResolvedValueOnce({ id: UUID_A });
    mDbQuery.mockResolvedValueOnce({
      data: [
        { id: 'p1', platform: 'twitter', status: 'succeeded', external_url: 'https://x/1', last_error: null },
        { id: 'p2', platform: 'linkedin', status: 'failed', external_url: null, last_error: 'token expired' },
      ],
      error: null,
    });
    const res = await req(makeApp(AUTH), `/api/social/posts/${UUID_A}/publishes`, 'GET', makeEnv());
    expect(res.status).toBe(200);
    const json = await jsonOf<{ data: Array<{ status: string; last_error: string | null }> }>(res);
    expect(json.data).toHaveLength(2);
    expect(json.data.find((r) => r.status === 'succeeded')).toBeTruthy();
    expect(json.data.find((r) => r.last_error === 'token expired')).toBeTruthy();
  });
});

// ─── Posts: analytics aggregation ─────────────────────────────────────────────────

describe('GET /api/social/posts/:id/analytics', () => {
  it('404s when the post is not in the org', async () => {
    mDbQueryOne.mockResolvedValueOnce(null);
    const res = await req(makeApp(AUTH), `/api/social/posts/${UUID_A}/analytics`, 'GET', makeEnv());
    expect(res.status).toBe(404);
  });

  it('aggregates totals across platforms (nulls coerced to 0)', async () => {
    mDbQueryOne.mockResolvedValueOnce({ id: UUID_A });
    mDbQuery.mockResolvedValueOnce({
      data: [
        { publish_id: 'p1', platform: 'twitter', impressions: 100, likes: 10, shares: 2, clicks: 5, reach: null, comments: null, saves: null },
        { publish_id: 'p2', platform: 'linkedin', impressions: 50, likes: null, shares: 1, clicks: null, reach: 20, comments: 3, saves: null },
      ],
      error: null,
    });
    const res = await req(makeApp(AUTH), `/api/social/posts/${UUID_A}/analytics`, 'GET', makeEnv());
    expect(res.status).toBe(200);
    const json = await jsonOf<{ data: { totals: Record<string, number>; per_platform: unknown[] } }>(res);
    expect(json.data.totals.impressions).toBe(150);
    expect(json.data.totals.likes).toBe(10);
    expect(json.data.totals.shares).toBe(3);
    expect(json.data.totals.reach).toBe(20);
    expect(json.data.per_platform).toHaveLength(2);
  });
});

// ─── Auto-Pilot config ─────────────────────────────────────────────────────────

describe('GET /api/social/auto-pilot/config', () => {
  it('401s when unauthenticated', async () => {
    const res = await req(makeApp(), '/api/social/auto-pilot/config', 'GET', makeEnv());
    expect(res.status).toBe(401);
  });

  it('returns the config with the default prompt attached', async () => {
    mLoadCfg.mockResolvedValueOnce({ enabled: false, prompt: '', cadence_hours: 24, target_networks: [] });
    const res = await req(makeApp(AUTH), '/api/social/auto-pilot/config', 'GET', makeEnv());
    expect(res.status).toBe(200);
    const json = await jsonOf<{ data: { default_prompt: string } }>(res);
    expect(json.data.default_prompt).toBe('DEFAULT-PROMPT');
    expect(mLoadCfg).toHaveBeenCalledWith(expect.anything(), 'org-1');
  });
});

describe('POST /api/social/auto-pilot/config', () => {
  it('400s on an unknown field (strict schema)', async () => {
    const res = await req(makeApp(AUTH), '/api/social/auto-pilot/config', 'POST', makeEnv(), { bogus: true });
    expect(res.status).toBe(400);
    expect(mUpsertCfg).not.toHaveBeenCalled();
  });

  it('upserts and echoes the row + default prompt', async () => {
    mUpsertCfg.mockResolvedValueOnce({ enabled: true, prompt: 'P', cadence_hours: 6, target_networks: ['twitter'] });
    const res = await req(makeApp(AUTH), '/api/social/auto-pilot/config', 'POST', makeEnv(), {
      enabled: true,
      cadence_hours: 6,
      target_networks: ['twitter'],
    });
    expect(res.status).toBe(200);
    const json = await jsonOf<{ data: { enabled: boolean; default_prompt: string } }>(res);
    expect(json.data.enabled).toBe(true);
    expect(json.data.default_prompt).toBe('DEFAULT-PROMPT');
    expect(mUpsertCfg).toHaveBeenCalledTimes(1);
  });
});

// ─── Auto-Pilot preview (AI mocked) ───────────────────────────────────────────────

describe('POST /api/social/auto-pilot/preview', () => {
  it('401s when unauthenticated', async () => {
    const res = await req(makeApp(), '/api/social/auto-pilot/preview', 'POST', makeEnv(), { network: 'twitter' });
    expect(res.status).toBe(401);
  });

  it('400s on an invalid network', async () => {
    const res = await req(makeApp(AUTH), '/api/social/auto-pilot/preview', 'POST', makeEnv(), { network: 'myspace' });
    expect(res.status).toBe(400);
  });

  it('returns a generated sample on success', async () => {
    mLoadCfg.mockResolvedValueOnce({ enabled: false, prompt: '', cadence_hours: 24, target_networks: [] });
    mGenPost.mockResolvedValueOnce({ text: 'sample tweet', mediaSuggestion: null });
    const res = await req(makeApp(AUTH), '/api/social/auto-pilot/preview', 'POST', makeEnv(), {
      network: 'twitter',
      prompt: 'be witty',
    });
    expect(res.status).toBe(200);
    expect((await jsonOf<{ data: { text: string } }>(res)).data.text).toBe('sample tweet');
    // Caller-supplied prompt wins over the saved one.
    expect(mGenPost).toHaveBeenCalledWith(expect.anything(), 'org-1', 'twitter', 'be witty');
  });

  it('502s with AI_GENERATION_ERROR when the LLM call throws', async () => {
    mLoadCfg.mockResolvedValueOnce({ enabled: false, prompt: '', cadence_hours: 24, target_networks: [] });
    mGenPost.mockRejectedValueOnce(new Error('no provider configured'));
    const res = await req(makeApp(AUTH), '/api/social/auto-pilot/preview', 'POST', makeEnv(), { network: 'twitter' });
    expect(res.status).toBe(502);
    expect((await jsonOf<{ error: { code: string } }>(res)).error.code).toBe('AI_GENERATION_ERROR');
  });
});

// ─── Auto-Pilot run-now ──────────────────────────────────────────────────────────

describe('POST /api/social/auto-pilot/run-now', () => {
  it('401s when unauthenticated', async () => {
    const res = await req(makeApp(), '/api/social/auto-pilot/run-now', 'POST', makeEnv());
    expect(res.status).toBe(401);
  });

  it('409s when no target networks are configured', async () => {
    mLoadCfg.mockResolvedValueOnce({ enabled: false, prompt: '', cadence_hours: 24, target_networks: [] });
    const res = await req(makeApp(AUTH), '/api/social/auto-pilot/run-now', 'POST', makeEnv());
    expect(res.status).toBe(409);
    expect((await jsonOf<{ error: { code: string } }>(res)).error.code).toBe('CONFLICT');
    expect(mGenPost).not.toHaveBeenCalled();
  });

  it('generates one draft per network, surviving a per-network failure', async () => {
    mLoadCfg.mockResolvedValueOnce({
      enabled: true,
      prompt: 'P',
      cadence_hours: 12,
      target_networks: ['twitter', 'linkedin'],
    });
    mGenPost
      .mockResolvedValueOnce({ text: 'tw post' }) // twitter ok
      .mockRejectedValueOnce(new Error('linkedin down')); // linkedin fails — must not abort the loop
    const res = await req(makeApp(AUTH), '/api/social/auto-pilot/run-now', 'POST', makeEnv());
    expect(res.status).toBe(200);
    const json = await jsonOf<{ data: { count: number; created: Array<{ network: string }> } }>(res);
    expect(json.data.count).toBe(1);
    expect(json.data.created[0].network).toBe('twitter');
    expect(mDbInsert).toHaveBeenCalledTimes(1);
    // Schedule cursor is pushed forward after the run.
    expect(mDbExecute).toHaveBeenCalledTimes(1);
  });
});

// ─── RSS import ─────────────────────────────────────────────────────────────────

describe('POST /api/social/import-rss', () => {
  const FEED = 'https://example.com/feed.xml';

  it('401s when unauthenticated', async () => {
    const res = await req(makeApp(), '/api/social/import-rss', 'POST', makeEnv(), { url: FEED });
    expect(res.status).toBe(401);
  });

  it('400s when the feed URL fails the SSRF guard', async () => {
    mSafeUrl.mockReturnValueOnce(false);
    const res = await req(makeApp(AUTH), '/api/social/import-rss', 'POST', makeEnv(), { url: FEED });
    expect(res.status).toBe(400);
  });

  it('returns parsed items on a preview request', async () => {
    mSafeUrl.mockReturnValueOnce(true);
    mParseRss.mockReturnValueOnce([{ title: 'Post A', url: 'https://x/a' }]);
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('<rss/>', { status: 200 }));
    const res = await req(makeApp(AUTH), '/api/social/import-rss', 'POST', makeEnv(), { url: FEED, preview: true });
    expect(res.status).toBe(200);
    expect((await jsonOf<{ items: unknown[] }>(res)).items).toHaveLength(1);
    expect(mBuildRss).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('imports items as draft rows on a non-preview request', async () => {
    mSafeUrl.mockReturnValueOnce(true);
    mParseRss.mockReturnValueOnce([{ title: 'Post A', url: 'https://x/a' }]);
    mBuildRss.mockReturnValueOnce([{ content: 'Post A', link: 'https://x/a' }]);
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('<rss/>', { status: 200 }));
    const res = await req(makeApp(AUTH), '/api/social/import-rss', 'POST', makeEnv(), { url: FEED });
    expect(res.status).toBe(200);
    expect((await jsonOf<{ ok: boolean; created: number }>(res)).created).toBe(1);
    expect(mDbInsert).toHaveBeenCalledTimes(1);
    fetchSpy.mockRestore();
  });

  it('400s when the upstream feed returns a non-OK status', async () => {
    mSafeUrl.mockReturnValueOnce(true);
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('nope', { status: 503 }));
    const res = await req(makeApp(AUTH), '/api/social/import-rss', 'POST', makeEnv(), { url: FEED });
    expect(res.status).toBe(400);
    fetchSpy.mockRestore();
  });
});

// ─── OG preview ─────────────────────────────────────────────────────────────────

describe('POST /api/social/og-preview', () => {
  const PAGE_URL = 'https://example.com/article';

  it('401s when unauthenticated', async () => {
    const res = await req(makeApp(), '/api/social/og-preview', 'POST', makeEnv(), { url: PAGE_URL });
    expect(res.status).toBe(401);
  });

  it('400s when the URL fails the SSRF guard', async () => {
    mSafeUrl.mockReturnValueOnce(false);
    const res = await req(makeApp(AUTH), '/api/social/og-preview', 'POST', makeEnv(), { url: PAGE_URL });
    expect(res.status).toBe(400);
  });

  it('returns parsed OG tags', async () => {
    mSafeUrl.mockReturnValueOnce(true);
    mParseOg.mockReturnValueOnce({ title: 'Article', description: 'D', image: 'https://x/og.png' });
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('<html/>', { status: 200 }));
    const res = await req(makeApp(AUTH), '/api/social/og-preview', 'POST', makeEnv(), { url: PAGE_URL });
    expect(res.status).toBe(200);
    expect((await jsonOf<{ og: { title: string } }>(res)).og.title).toBe('Article');
    fetchSpy.mockRestore();
  });
});
