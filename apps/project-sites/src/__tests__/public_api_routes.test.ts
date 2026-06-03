/**
 * Route coverage for the Public REST API v1 (`/v1/*`) — convergence r44.
 *
 * Exercises the real {@link publicApiV1} Hono sub-app end-to-end, mocking only
 * the boundaries: the `public_api_v1` feature flag, `verifyApiToken` (so we
 * never touch crypto/D1 for auth), and the D1 + R2 bindings for resource
 * queries. `extractBearerToken` + `hasScope` + `VALID_SCOPES` stay REAL so the
 * Bearer-format regex and scope-enforcement logic are genuinely tested.
 *
 * Covers, per the route's handler surface:
 *  - feature flag gate (503 when off)
 *  - token auth (401 missing / malformed / invalid)
 *  - scope enforcement (403 missing scope, `me:read` implicit grant)
 *  - each resource endpoint success + org scoping + not-found (404)
 *  - Zod validation (400) on POST /v1/sites + PATCH /v1/sites/:id
 *  - conflict (409) on duplicate slug
 *  - DELETE 204 / 404, deploy 200, media upload bad-request (400)
 *  - analytics range handling, openapi.json public access
 */

jest.mock('../modules/feature_flags/services.js', () => ({
  isFlagOn: jest.fn(),
}));

jest.mock('../services/api_tokens.js', () => {
  const actual = jest.requireActual('../services/api_tokens.js');
  return {
    ...actual,
    verifyApiToken: jest.fn(),
  };
});

import type { Env } from '../types/env.js';
import { publicApiV1 } from '../routes/public_api.js';
import { isFlagOn } from '../modules/feature_flags/services.js';
import {
  verifyApiToken,
  type ApiScope,
  type ApiTokenRow,
} from '../services/api_tokens.js';

const mockIsFlagOn = isFlagOn as unknown as jest.Mock;
const mockVerifyApiToken = verifyApiToken as unknown as jest.Mock;

// ─── D1 mock ─────────────────────────────────────────────────────────────────

interface StmtPlan {
  first?: unknown;
  all?: { results: unknown[] };
  run?: { meta?: { changes?: number } };
}

/**
 * Configurable D1 mock. `plans` is an ordered queue: each `prepare(...)` call
 * pops the next plan and the returned statement resolves `first/all/run` from
 * it. Falls back to a benign empty result when the queue is drained.
 */
function makeDb(plans: StmtPlan[] = []) {
  const queue = [...plans];
  const prepareMock = jest.fn(() => {
    const plan = queue.shift() ?? {};
    const stmt = {
      bind: jest.fn(() => stmt),
      first: jest.fn(async () => (plan.first === undefined ? null : plan.first)),
      all: jest.fn(async () => plan.all ?? { results: [] }),
      run: jest.fn(async () => plan.run ?? { meta: { changes: 0 } }),
    };
    return stmt;
  });
  return { prepare: prepareMock, _prepare: prepareMock } as unknown as D1Database & {
    _prepare: jest.Mock;
  };
}

/** R2 mock with a spyable `put`. */
function makeBucket() {
  return { put: jest.fn(async () => ({})) } as unknown as R2Bucket & { put: jest.Mock };
}

function makeEnv(overrides: Partial<Record<string, unknown>> = {}): Env {
  return {
    ENVIRONMENT: 'test',
    DB: makeDb(),
    SITES_BUCKET: makeBucket(),
    ...overrides,
  } as unknown as Env;
}

// ─── Token fixtures ──────────────────────────────────────────────────────────

const ORG = 'org-abc';
const VALID_BEARER = 'psk_' + 'a'.repeat(64); // matches /^Bearer (psk_[a-f0-9]{64})$/

function tokenRow(scopes: ApiScope[], orgId = ORG): ApiTokenRow {
  return {
    id: 'tok-1',
    org_id: orgId,
    name: 'CI token',
    token_hash: 'hash',
    scopes: JSON.stringify(scopes),
    last_used_at: null,
    expires_at: null,
    revoked_at: null,
    created_by: 'user-1',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };
}

// ─── Request helpers ─────────────────────────────────────────────────────────

function req(
  path: string,
  init: RequestInit & { bearer?: string | null } = {},
  env: Env = makeEnv(),
) {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (init.bearer !== null && init.bearer !== undefined) {
    headers['Authorization'] = `Bearer ${init.bearer}`;
  }
  return publicApiV1.request(
    path,
    { method: init.method ?? 'GET', headers, body: init.body },
    env,
  );
}

function jsonReq(path: string, method: string, body: unknown, bearer: string | null, env: Env) {
  return req(
    path,
    {
      method,
      bearer,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    env,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockIsFlagOn.mockResolvedValue(true); // flag ON by default
  mockVerifyApiToken.mockResolvedValue(null); // no token by default
});

// ─── Feature flag gate ───────────────────────────────────────────────────────

describe('public API — feature flag gate', () => {
  it('returns 503 feature_disabled for every /v1 route when the flag is off', async () => {
    mockIsFlagOn.mockResolvedValue(false);
    const res = await req('/v1/sites', { bearer: VALID_BEARER });
    expect(res.status).toBe(503);
    const json = (await res.json()) as { error?: string };
    expect(json.error).toBe('feature_disabled');
    // Auth never runs once the gate rejects.
    expect(mockVerifyApiToken).not.toHaveBeenCalled();
  });

  it('gates openapi.json too when the flag is off', async () => {
    mockIsFlagOn.mockResolvedValue(false);
    const res = await req('/v1/openapi.json', { bearer: null });
    expect(res.status).toBe(503);
  });
});

// ─── Auth ────────────────────────────────────────────────────────────────────

describe('public API — bearer token auth', () => {
  it('returns 401 when no Authorization header is present', async () => {
    const res = await req('/v1/sites', { bearer: null });
    expect(res.status).toBe(401);
    const json = (await res.json()) as { error?: string };
    expect(json.error).toBe('unauthorized');
    expect(mockVerifyApiToken).not.toHaveBeenCalled();
  });

  it('returns 401 when the bearer token is malformed (fails psk_<64hex> regex)', async () => {
    const res = await req('/v1/sites', { bearer: 'psk_short' });
    expect(res.status).toBe(401);
    // extractBearerToken returns null → verify never called.
    expect(mockVerifyApiToken).not.toHaveBeenCalled();
  });

  it('returns 401 when the token is well-formed but not found / revoked / expired', async () => {
    mockVerifyApiToken.mockResolvedValue(null);
    const res = await req('/v1/sites', { bearer: VALID_BEARER });
    expect(res.status).toBe(401);
    const json = (await res.json()) as { error?: string };
    expect(json.error).toBe('unauthorized');
    expect(mockVerifyApiToken).toHaveBeenCalledTimes(1);
  });
});

// ─── Scope enforcement ───────────────────────────────────────────────────────

describe('public API — scope enforcement', () => {
  it('returns 403 with the missing-scope message when the token lacks the scope', async () => {
    mockVerifyApiToken.mockResolvedValue(tokenRow([])); // empty scopes
    const res = await req('/v1/sites', { bearer: VALID_BEARER });
    expect(res.status).toBe(403);
    const json = (await res.json()) as { error?: string; message?: string };
    expect(json.error).toBe('forbidden');
    expect(json.message).toContain('sites:read');
  });

  it('grants /v1/me to any valid token (me:read is implicit) even with empty scopes', async () => {
    mockVerifyApiToken.mockResolvedValue(tokenRow([]));
    const env = makeEnv({ DB: makeDb([{ first: { id: ORG, name: 'Acme', created_at: 'x' } }]) });
    const res = await req('/v1/me', { bearer: VALID_BEARER }, env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { token_id: string; org: { id: string }; scopes: string[] };
    expect(json.token_id).toBe('tok-1');
    expect(json.org.id).toBe(ORG);
    expect(json.scopes).toEqual([]);
  });

  it('write endpoints reject a read-only token (403)', async () => {
    mockVerifyApiToken.mockResolvedValue(tokenRow(['sites:read']));
    const res = await jsonReq('/v1/sites', 'POST', { slug: 'x', business_name: 'X' }, VALID_BEARER, makeEnv());
    expect(res.status).toBe(403);
  });
});

// ─── /v1/me ──────────────────────────────────────────────────────────────────

describe('GET /v1/me', () => {
  it('falls back to a null org name when the org row is missing', async () => {
    mockVerifyApiToken.mockResolvedValue(tokenRow(['sites:read']));
    const env = makeEnv({ DB: makeDb([{ first: null }]) });
    const res = await req('/v1/me', { bearer: VALID_BEARER }, env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { org: { id: string; name: string | null }; scopes: string[] };
    expect(json.org).toEqual({ id: ORG, name: null });
    expect(json.scopes).toEqual(['sites:read']);
  });
});

// ─── GET /v1/sites (list) ──────────────────────────────────────────────────────

describe('GET /v1/sites', () => {
  it('returns org-scoped sites with pagination metadata', async () => {
    mockVerifyApiToken.mockResolvedValue(tokenRow(['sites:read']));
    const sites = [{ id: 's1', slug: 'a', business_name: 'A', status: 'published' }];
    const env = makeEnv({ DB: makeDb([{ all: { results: sites } }, { first: { n: 1 } }]) });
    const res = await req('/v1/sites?limit=5&offset=0', { bearer: VALID_BEARER }, env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: unknown[]; total: number; limit: number };
    expect(json.data).toEqual(sites);
    expect(json.total).toBe(1);
    expect(json.limit).toBe(5);
    // First query is the org-scoped SELECT.
    const prepared = (env.DB as unknown as { _prepare: jest.Mock })._prepare;
    expect(prepared.mock.calls[0][0]).toContain('WHERE org_id = ?');
  });

  it('returns an empty list (total 0) when the org has no sites', async () => {
    mockVerifyApiToken.mockResolvedValue(tokenRow(['sites:read']));
    const env = makeEnv({ DB: makeDb([{ all: { results: [] } }, { first: { n: 0 } }]) });
    const res = await req('/v1/sites', { bearer: VALID_BEARER }, env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: unknown[]; total: number };
    expect(json.data).toEqual([]);
    expect(json.total).toBe(0);
  });
});

// ─── GET /v1/sites/:id ──────────────────────────────────────────────────────────

describe('GET /v1/sites/:id', () => {
  it('returns the site when found within the org', async () => {
    mockVerifyApiToken.mockResolvedValue(tokenRow(['sites:read']));
    const site = { id: 's1', slug: 'a', business_name: 'A', status: 'published' };
    const env = makeEnv({ DB: makeDb([{ first: site }]) });
    const res = await req('/v1/sites/s1', { bearer: VALID_BEARER }, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(site);
  });

  it('returns 404 not_found when the site is not in the token org', async () => {
    mockVerifyApiToken.mockResolvedValue(tokenRow(['sites:read']));
    const env = makeEnv({ DB: makeDb([{ first: null }]) });
    const res = await req('/v1/sites/other-org-site', { bearer: VALID_BEARER }, env);
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error?: string };
    expect(json.error).toBe('not_found');
  });
});

// ─── POST /v1/sites (create) ───────────────────────────────────────────────────

describe('POST /v1/sites', () => {
  it('creates a site (201) and scopes the INSERT to the token org', async () => {
    mockVerifyApiToken.mockResolvedValue(tokenRow(['sites:write']));
    // 1st query: slug-uniqueness check → null (available). 2nd: INSERT run.
    const env = makeEnv({ DB: makeDb([{ first: null }, { run: { meta: { changes: 1 } } }]) });
    const res = await jsonReq('/v1/sites', 'POST', { slug: 'apple', business_name: 'Apple' }, VALID_BEARER, env);
    expect(res.status).toBe(201);
    const json = (await res.json()) as { slug: string; org_id: string; status: string };
    expect(json.slug).toBe('apple');
    expect(json.org_id).toBe(ORG);
    expect(json.status).toBe('draft');
  });

  it('returns 400 on Zod failure (missing business_name)', async () => {
    mockVerifyApiToken.mockResolvedValue(tokenRow(['sites:write']));
    const res = await jsonReq('/v1/sites', 'POST', { slug: 'apple' }, VALID_BEARER, makeEnv());
    expect(res.status).toBe(400);
  });

  it('returns 400 on Zod failure (bad slug format — uppercase)', async () => {
    mockVerifyApiToken.mockResolvedValue(tokenRow(['sites:write']));
    const res = await jsonReq('/v1/sites', 'POST', { slug: 'Apple Store', business_name: 'Apple' }, VALID_BEARER, makeEnv());
    expect(res.status).toBe(400);
  });

  it('returns 409 conflict when the slug is already taken', async () => {
    mockVerifyApiToken.mockResolvedValue(tokenRow(['sites:write']));
    const env = makeEnv({ DB: makeDb([{ first: { id: 'existing' } }]) });
    const res = await jsonReq('/v1/sites', 'POST', { slug: 'taken', business_name: 'Dup' }, VALID_BEARER, env);
    expect(res.status).toBe(409);
    const json = (await res.json()) as { error?: string };
    expect(json.error).toBe('conflict');
  });
});

// ─── PATCH /v1/sites/:id ────────────────────────────────────────────────────────

describe('PATCH /v1/sites/:id', () => {
  it('updates business_name (200) and returns the refreshed row', async () => {
    mockVerifyApiToken.mockResolvedValue(tokenRow(['sites:write']));
    const updated = { id: 's1', slug: 'a', business_name: 'New Name', status: 'draft' };
    // 1: ownership check → row, 2: UPDATE run, 3: re-SELECT → updated
    const env = makeEnv({ DB: makeDb([{ first: { id: 's1' } }, { run: { meta: { changes: 1 } } }, { first: updated }]) });
    const res = await jsonReq('/v1/sites/s1', 'PATCH', { business_name: 'New Name' }, VALID_BEARER, env);
    expect(res.status).toBe(200);
    expect((await res.json() as { business_name: string }).business_name).toBe('New Name');
  });

  it('returns 404 when patching a site outside the org', async () => {
    mockVerifyApiToken.mockResolvedValue(tokenRow(['sites:write']));
    const env = makeEnv({ DB: makeDb([{ first: null }]) });
    const res = await jsonReq('/v1/sites/nope', 'PATCH', { business_name: 'X' }, VALID_BEARER, env);
    expect(res.status).toBe(404);
  });

  it('returns 400 when neither business_name nor slug is provided (refine)', async () => {
    mockVerifyApiToken.mockResolvedValue(tokenRow(['sites:write']));
    const res = await jsonReq('/v1/sites/s1', 'PATCH', {}, VALID_BEARER, makeEnv());
    expect(res.status).toBe(400);
  });
});

// ─── DELETE /v1/sites/:id ───────────────────────────────────────────────────────

describe('DELETE /v1/sites/:id', () => {
  it('soft-deletes the site (204) when it belongs to the org', async () => {
    mockVerifyApiToken.mockResolvedValue(tokenRow(['sites:write']));
    const env = makeEnv({ DB: makeDb([{ run: { meta: { changes: 1 } } }]) });
    const res = await req('/v1/sites/s1', { method: 'DELETE', bearer: VALID_BEARER }, env);
    expect(res.status).toBe(204);
  });

  it('returns 404 when the delete affects no rows (wrong org / already gone)', async () => {
    mockVerifyApiToken.mockResolvedValue(tokenRow(['sites:write']));
    const env = makeEnv({ DB: makeDb([{ run: { meta: { changes: 0 } } }]) });
    const res = await req('/v1/sites/s1', { method: 'DELETE', bearer: VALID_BEARER }, env);
    expect(res.status).toBe(404);
  });
});

// ─── GET /v1/sites/:id/snapshots ────────────────────────────────────────────────

describe('GET /v1/sites/:id/snapshots', () => {
  it('returns snapshots for an owned site', async () => {
    mockVerifyApiToken.mockResolvedValue(tokenRow(['sites:read']));
    const snaps = [{ id: 'snap1', site_id: 's1', version: 'v1', label: 'initial' }];
    const env = makeEnv({ DB: makeDb([{ first: { id: 's1' } }, { all: { results: snaps } }]) });
    const res = await req('/v1/sites/s1/snapshots', { bearer: VALID_BEARER }, env);
    expect(res.status).toBe(200);
    expect((await res.json() as { data: unknown[] }).data).toEqual(snaps);
  });

  it('returns 404 when the parent site is not owned', async () => {
    mockVerifyApiToken.mockResolvedValue(tokenRow(['sites:read']));
    const env = makeEnv({ DB: makeDb([{ first: null }]) });
    const res = await req('/v1/sites/s1/snapshots', { bearer: VALID_BEARER }, env);
    expect(res.status).toBe(404);
  });
});

// ─── POST /v1/sites/:id/deploy ──────────────────────────────────────────────────

describe('POST /v1/sites/:id/deploy', () => {
  it('queues a deploy job (200) and echoes a job_id', async () => {
    mockVerifyApiToken.mockResolvedValue(tokenRow(['sites:write']));
    const env = makeEnv({ DB: makeDb([{ first: { id: 's1', slug: 'a', status: 'published' } }, { run: { meta: { changes: 1 } } }]) });
    const res = await req('/v1/sites/s1/deploy', { method: 'POST', bearer: VALID_BEARER }, env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { job_id: string; status: string; site_id: string };
    expect(json.status).toBe('queued');
    expect(json.site_id).toBe('s1');
    expect(typeof json.job_id).toBe('string');
  });

  it('returns 404 when deploying a site outside the org', async () => {
    mockVerifyApiToken.mockResolvedValue(tokenRow(['sites:write']));
    const env = makeEnv({ DB: makeDb([{ first: null }]) });
    const res = await req('/v1/sites/s1/deploy', { method: 'POST', bearer: VALID_BEARER }, env);
    expect(res.status).toBe(404);
  });
});

// ─── Media ──────────────────────────────────────────────────────────────────────

describe('GET /v1/sites/:id/media', () => {
  it('lists media for an owned site', async () => {
    mockVerifyApiToken.mockResolvedValue(tokenRow(['media:read']));
    const media = [{ id: 'm1', kind: 'image', filename: 'hero.png', r2_key: 'k', size_bytes: 10 }];
    const env = makeEnv({ DB: makeDb([{ first: { id: 's1' } }, { all: { results: media } }]) });
    const res = await req('/v1/sites/s1/media', { bearer: VALID_BEARER }, env);
    expect(res.status).toBe(200);
    expect((await res.json() as { data: unknown[] }).data).toEqual(media);
  });

  it('returns 403 when the token lacks media:read', async () => {
    mockVerifyApiToken.mockResolvedValue(tokenRow(['sites:read']));
    const res = await req('/v1/sites/s1/media', { bearer: VALID_BEARER });
    expect(res.status).toBe(403);
  });

  it('returns 404 when the site is not owned', async () => {
    mockVerifyApiToken.mockResolvedValue(tokenRow(['media:read']));
    const env = makeEnv({ DB: makeDb([{ first: null }]) });
    const res = await req('/v1/sites/s1/media', { bearer: VALID_BEARER }, env);
    expect(res.status).toBe(404);
  });
});

describe('POST /v1/sites/:id/media', () => {
  it('uploads a file (201) — writes to R2 and inserts a media row', async () => {
    mockVerifyApiToken.mockResolvedValue(tokenRow(['media:write']));
    const bucket = makeBucket();
    const env = makeEnv({
      DB: makeDb([{ first: { id: 's1' } }, { run: { meta: { changes: 1 } } }]),
      SITES_BUCKET: bucket,
    });
    const form = new FormData();
    form.append('file', new File(['hello'], 'photo.png', { type: 'image/png' }));
    const res = await publicApiV1.request(
      '/v1/sites/s1/media',
      { method: 'POST', headers: { Authorization: `Bearer ${VALID_BEARER}` }, body: form },
      env,
    );
    expect(res.status).toBe(201);
    const json = (await res.json()) as { filename: string; site_id: string; size_bytes: number };
    expect(json.filename).toBe('photo.png');
    expect(json.site_id).toBe('s1');
    expect((bucket as unknown as { put: jest.Mock }).put).toHaveBeenCalledTimes(1);
  });

  it('returns 400 when the multipart body has no file field', async () => {
    mockVerifyApiToken.mockResolvedValue(tokenRow(['media:write']));
    const env = makeEnv({ DB: makeDb([{ first: { id: 's1' } }]) });
    const form = new FormData();
    form.append('notafile', 'oops');
    const res = await publicApiV1.request(
      '/v1/sites/s1/media',
      { method: 'POST', headers: { Authorization: `Bearer ${VALID_BEARER}` }, body: form },
      env,
    );
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error?: string };
    expect(json.error).toBe('bad_request');
  });

  it('returns 404 when uploading to a site outside the org', async () => {
    mockVerifyApiToken.mockResolvedValue(tokenRow(['media:write']));
    const env = makeEnv({ DB: makeDb([{ first: null }]) });
    const form = new FormData();
    form.append('file', new File(['x'], 'x.png', { type: 'image/png' }));
    const res = await publicApiV1.request(
      '/v1/sites/s1/media',
      { method: 'POST', headers: { Authorization: `Bearer ${VALID_BEARER}` }, body: form },
      env,
    );
    expect(res.status).toBe(404);
  });
});

// ─── Form submissions ────────────────────────────────────────────────────────────

describe('GET /v1/sites/:id/forms/submissions', () => {
  it('returns submissions with the JSON `data` field parsed', async () => {
    mockVerifyApiToken.mockResolvedValue(tokenRow(['forms:read']));
    const rows = [{ id: 'f1', form_slug: 'contact', data: '{"email":"a@b.com"}', submitted_at: 't' }];
    const env = makeEnv({ DB: makeDb([{ first: { id: 's1' } }, { all: { results: rows } }]) });
    const res = await req('/v1/sites/s1/forms/submissions', { bearer: VALID_BEARER }, env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: Array<{ data: unknown }> };
    expect(json.data[0].data).toEqual({ email: 'a@b.com' });
  });

  it('leaves the data field as-is when it is not valid JSON', async () => {
    mockVerifyApiToken.mockResolvedValue(tokenRow(['forms:read']));
    const rows = [{ id: 'f1', form_slug: 'contact', data: 'raw-string', submitted_at: 't' }];
    const env = makeEnv({ DB: makeDb([{ first: { id: 's1' } }, { all: { results: rows } }]) });
    const res = await req('/v1/sites/s1/forms/submissions', { bearer: VALID_BEARER }, env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: Array<{ data: unknown }> };
    expect(json.data[0].data).toBe('raw-string');
  });

  it('returns 404 when the site is not owned', async () => {
    mockVerifyApiToken.mockResolvedValue(tokenRow(['forms:read']));
    const env = makeEnv({ DB: makeDb([{ first: null }]) });
    const res = await req('/v1/sites/s1/forms/submissions', { bearer: VALID_BEARER }, env);
    expect(res.status).toBe(404);
  });
});

// ─── Analytics ───────────────────────────────────────────────────────────────────

describe('GET /v1/sites/:id/analytics', () => {
  it('returns aggregated analytics with the default 7d range', async () => {
    mockVerifyApiToken.mockResolvedValue(tokenRow(['analytics:read']));
    const daily = [{ date: '2026-01-01', pageviews: 10, unique_visitors: 5, avg_duration_seconds: 30 }];
    const env = makeEnv({
      DB: makeDb([
        { first: { id: 's1' } },
        { all: { results: daily } },
        { first: { total_pageviews: 10, total_visitors: 5 } },
      ]),
    });
    const res = await req('/v1/sites/s1/analytics', { bearer: VALID_BEARER }, env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { range: string; total_pageviews: number; daily: unknown[] };
    expect(json.range).toBe('7d');
    expect(json.total_pageviews).toBe(10);
    expect(json.daily).toEqual(daily);
  });

  it('honors an explicit range query (30d)', async () => {
    mockVerifyApiToken.mockResolvedValue(tokenRow(['analytics:read']));
    const env = makeEnv({
      DB: makeDb([{ first: { id: 's1' } }, { all: { results: [] } }, { first: null }]),
    });
    const res = await req('/v1/sites/s1/analytics?range=30d', { bearer: VALID_BEARER }, env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { range: string; total_pageviews: number };
    expect(json.range).toBe('30d');
    expect(json.total_pageviews).toBe(0); // null totals coerce to 0
  });

  it('returns 404 when the site is not owned', async () => {
    mockVerifyApiToken.mockResolvedValue(tokenRow(['analytics:read']));
    const env = makeEnv({ DB: makeDb([{ first: null }]) });
    const res = await req('/v1/sites/s1/analytics', { bearer: VALID_BEARER }, env);
    expect(res.status).toBe(404);
  });
});

// ─── OpenAPI spec (public — no auth) ───────────────────────────────────────────

describe('GET /v1/openapi.json', () => {
  it('serves the OpenAPI 3.1 spec without a bearer token', async () => {
    const res = await req('/v1/openapi.json', { bearer: null });
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toContain('max-age=3600');
    const json = (await res.json()) as { openapi: string; paths: Record<string, unknown> };
    expect(json.openapi).toBe('3.1.0');
    expect(json.paths['/v1/sites']).toBeDefined();
    // Auth is skipped for the spec route.
    expect(mockVerifyApiToken).not.toHaveBeenCalled();
  });
});
