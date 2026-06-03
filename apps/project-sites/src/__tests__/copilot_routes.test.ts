/**
 * Route coverage for the multimodal AI Site Copilot router (convergence r42).
 *
 * Exercises every handler in `routes/copilot.ts` end-to-end through the real
 * Hono app, mocking only the boundaries: the feature-flag gate, the
 * site-ownership check, the multimodal-intent service, and D1.
 *
 * Covered:
 *   - POST  /api/sites/:slug/copilot/intent  — slug resolution 404, flag-gate
 *     404, Zod-ish 400 (no input), JSON-body success, multipart success,
 *     image-too-large 413, intent service mocked.
 *   - GET   /api/sites/:siteId/copilot/sessions (admin) — 401, ownership 404,
 *     flag 404, success (sessions + intent distribution).
 *   - GET   /api/sites/:siteId/copilot/config (admin) — 401, success default.
 *   - PUT   /api/sites/:siteId/copilot/config (admin) — 401, Zod 400, success.
 *   - Tenant isolation: the admin guard reads the org from the SESSION
 *     (`c.get('orgId')`), NEVER a client-supplied `x-org-id` header.
 */

jest.mock('../modules/feature_flags/services.js', () => ({
  isFlagOn: jest.fn(),
}));

jest.mock('../services/site_ownership.js', () => ({
  assertSiteOwned: jest.fn(),
}));

jest.mock('../services/multimodal_intent.js', () => ({
  processMultimodalIntent: jest.fn(),
  saveCopilotSession: jest.fn(),
}));

import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { errorHandler } from '../middleware/error_handler.js';
import { copilot } from '../routes/copilot.js';
import { isFlagOn } from '../modules/feature_flags/services.js';
import { assertSiteOwned } from '../services/site_ownership.js';
import { processMultimodalIntent, saveCopilotSession } from '../services/multimodal_intent.js';

const mockIsFlagOn = isFlagOn as unknown as jest.Mock;
const mockAssertSiteOwned = assertSiteOwned as unknown as jest.Mock;
const mockProcessIntent = processMultimodalIntent as unknown as jest.Mock;
const mockSaveSession = saveCopilotSession as unknown as jest.Mock;

// ─── D1 mock ─────────────────────────────────────────────────────────────────

interface PrepareHandlers {
  first?: (sql: string, args: unknown[]) => unknown;
  all?: (sql: string, args: unknown[]) => { results?: unknown[] };
  run?: (sql: string, args: unknown[]) => unknown;
}

/**
 * Build a D1 mock whose `first/all/run` dispatch off the SQL text so a single
 * harness can serve slug-resolution, sessions, distribution, config reads, and
 * the config upsert without ordering assumptions.
 */
function makeDb(handlers: PrepareHandlers = {}) {
  return {
    prepare: jest.fn((sql: string) => {
      let bound: unknown[] = [];
      const stmt = {
        bind: (...a: unknown[]) => {
          bound = a;
          return stmt;
        },
        first: jest.fn(async () => (handlers.first ? handlers.first(sql, bound) : null)),
        all: jest.fn(async () => (handlers.all ? handlers.all(sql, bound) : { results: [] })),
        run: jest.fn(async () => (handlers.run ? handlers.run(sql, bound) : { success: true })),
      };
      return stmt;
    }),
  } as unknown as D1Database;
}

function makeEnv(overrides: Partial<Record<string, unknown>> = {}): Env {
  return {
    ENVIRONMENT: 'test',
    DB: makeDb(),
    SITES_BUCKET: { get: jest.fn(async () => null) },
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
  app.route('/', copilot);
  return app;
}

function makeCtx(): ExecutionContext {
  return {
    waitUntil: (_p: Promise<unknown>) => {},
    passThroughOnException: () => {},
  } as unknown as ExecutionContext;
}

const AUTH: Partial<Variables> = { userId: 'user-1', orgId: 'org-1', requestId: 'req-1' };

/** Canonical happy-path intent service result. */
function intentResult() {
  return {
    intent: 'book',
    extracted_fields: { name: 'Pat', service: 'haircut' },
    suggested_route: '/book',
    transcript: undefined,
    latency: { whisper_ms: 0, vision_ms: 0, classify_ms: 12, total_ms: 12 },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSaveSession.mockResolvedValue(undefined);
});

// ════════════════════════════════════════════════════════════════════════════
// POST /api/sites/:slug/copilot/intent  (public)
// ════════════════════════════════════════════════════════════════════════════

describe('POST /api/sites/:slug/copilot/intent', () => {
  function postJson(app: Hono<{ Bindings: Env; Variables: Variables }>, env: Env, body: unknown) {
    return app.request(
      '/api/sites/acme/copilot/intent',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      env,
      makeCtx(),
    );
  }

  it('returns 404 when the slug resolves to no site', async () => {
    const env = makeEnv({ DB: makeDb({ first: () => null }) });
    const res = await postJson(makeApp(), env, { text: 'hi' });
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error?: string };
    expect(json.error).toBe('not_found');
    expect(mockProcessIntent).not.toHaveBeenCalled();
  });

  it('returns 404 when the feature flag is off (never leaks existence)', async () => {
    const env = makeEnv({ DB: makeDb({ first: () => ({ id: 'site-1', org_id: 'org-1' }) }) });
    mockIsFlagOn.mockResolvedValue(false);
    const res = await postJson(makeApp(), env, { text: 'hi' });
    expect(res.status).toBe(404);
    // Scope is the authenticated org/site resolved from the slug (object form).
    expect(mockIsFlagOn).toHaveBeenCalledWith(env, 'multimodal_copilot', {
      orgId: 'org-1',
      siteId: 'site-1',
    });
    expect(mockProcessIntent).not.toHaveBeenCalled();
  });

  it('returns 400 when no text|audio|image input is provided', async () => {
    const env = makeEnv({ DB: makeDb({ first: () => ({ id: 'site-1', org_id: 'org-1' }) }) });
    mockIsFlagOn.mockResolvedValue(true);
    const res = await postJson(makeApp(), env, {}); // valid JSON, but no text
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error?: string };
    expect(json.error).toMatch(/text\|audio\|image/);
    expect(mockProcessIntent).not.toHaveBeenCalled();
  });

  // NOTE (route finding, convergence r42): the documented JSON-body fallback
  // never fires under Hono 4.11 — `c.req.formData()` on a JSON payload returns
  // an empty FormData instead of throwing, so the `catch` JSON branch is dead
  // code and `textInput` stays null. A pure JSON `{ text }` body therefore
  // yields 400, NOT 200. The supported text path is multipart form-data. This
  // test locks the actual contract (multipart works) while documenting the
  // JSON-body gap below. Reported, not fixed, per the convergence brief.
  it('returns 200 with the intent payload on a valid MULTIPART (text-only) request', async () => {
    const env = makeEnv({ DB: makeDb({ first: () => ({ id: 'site-1', org_id: 'org-1' }) }) });
    mockIsFlagOn.mockResolvedValue(true);
    mockProcessIntent.mockResolvedValue(intentResult());

    const fd = new FormData();
    fd.append('text', 'I want to book a haircut');
    const res = await makeApp().request(
      '/api/sites/acme/copilot/intent',
      { method: 'POST', body: fd },
      env,
      makeCtx(),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      intent: string;
      extracted_fields: Record<string, string>;
      suggested_route: string;
      latency_ms: number;
    };
    expect(json.intent).toBe('book');
    expect(json.suggested_route).toBe('/book');
    expect(json.extracted_fields.service).toBe('haircut');
    expect(json.latency_ms).toBe(12);

    // Intent service is fed the org/site resolved from the slug, not the client.
    expect(mockProcessIntent).toHaveBeenCalledTimes(1);
    expect(mockProcessIntent.mock.calls[0][1]).toMatchObject({
      text: 'I want to book a haircut',
      orgId: 'org-1',
      siteId: 'site-1',
      siteSlug: 'acme',
    });
    // Session persisted (fire-and-forget).
    expect(mockSaveSession).toHaveBeenCalledTimes(1);
  });

  it('returns 400 for a JSON-body request — the documented JSON fallback is dead code', async () => {
    const env = makeEnv({ DB: makeDb({ first: () => ({ id: 'site-1', org_id: 'org-1' }) }) });
    mockIsFlagOn.mockResolvedValue(true);
    mockProcessIntent.mockResolvedValue(intentResult());

    const res = await postJson(makeApp(), env, { text: 'I want to book a haircut' });
    // Hono 4.11 formData() does not throw on JSON → empty form → textInput null.
    expect(res.status).toBe(400);
    expect(mockProcessIntent).not.toHaveBeenCalled();
  });

  it('returns 413 when an attached image exceeds the 5MB cap', async () => {
    const env = makeEnv({ DB: makeDb({ first: () => ({ id: 'site-1', org_id: 'org-1' }) }) });
    mockIsFlagOn.mockResolvedValue(true);

    const big = new Blob([new Uint8Array(6 * 1024 * 1024)], { type: 'image/png' });
    const fd = new FormData();
    fd.append('image', big, 'big.png');
    const res = await makeApp().request(
      '/api/sites/acme/copilot/intent',
      { method: 'POST', body: fd },
      env,
      makeCtx(),
    );
    expect(res.status).toBe(413);
    const json = (await res.json()) as { error?: string };
    expect(json.error).toBe('image_too_large');
    expect(mockProcessIntent).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// GET /api/sites/:siteId/copilot/sessions  (admin)
// ════════════════════════════════════════════════════════════════════════════

describe('GET /api/sites/:siteId/copilot/sessions', () => {
  function get(app: Hono<{ Bindings: Env; Variables: Variables }>, env: Env, headers: Record<string, string> = {}) {
    return app.request('/api/sites/site-1/copilot/sessions', { method: 'GET', headers }, env, makeCtx());
  }

  it('returns 401 when the request is unauthenticated', async () => {
    const env = makeEnv();
    const res = await get(makeApp(), env);
    expect(res.status).toBe(401);
    const json = (await res.json()) as { error?: string };
    expect(json.error).toBe('unauthorized');
    expect(mockAssertSiteOwned).not.toHaveBeenCalled();
  });

  it('returns 404 when the caller org does not own the site', async () => {
    const env = makeEnv();
    mockAssertSiteOwned.mockResolvedValue(false);
    const res = await get(makeApp(AUTH), env);
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error?: string };
    expect(json.error).toBe('not_found');
    expect(mockIsFlagOn).not.toHaveBeenCalled();
  });

  it('returns 404 when ownership passes but the flag is off', async () => {
    const env = makeEnv();
    mockAssertSiteOwned.mockResolvedValue(true);
    mockIsFlagOn.mockResolvedValue(false);
    const res = await get(makeApp(AUTH), env);
    expect(res.status).toBe(404);
  });

  it('reads the tenant org from the SESSION, never a client x-org-id header', async () => {
    const env = makeEnv();
    mockAssertSiteOwned.mockResolvedValue(false);
    // Attacker tries to spoof a different org via header.
    await get(makeApp(AUTH), env, { 'x-org-id': 'org-evil' });
    // Ownership must be checked against the authenticated session org, not the header.
    expect(mockAssertSiteOwned).toHaveBeenCalledWith(env, 'org-1', 'site-1');
    expect(mockAssertSiteOwned).not.toHaveBeenCalledWith(env, 'org-evil', 'site-1');
  });

  it('returns 200 with sessions and intent distribution on success', async () => {
    const sessionRows = [{ id: 's1', intent: 'book', total_ms: 10, status: 'ok' }];
    const distRows = [{ intent: 'book', count: 4 }];
    const env = makeEnv({
      DB: makeDb({
        all: (sql) => (sql.includes('GROUP BY intent') ? { results: distRows } : { results: sessionRows }),
      }),
    });
    mockAssertSiteOwned.mockResolvedValue(true);
    mockIsFlagOn.mockResolvedValue(true);

    const res = await get(makeApp(AUTH), env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      sessions: unknown[];
      distribution: unknown[];
      total: number;
    };
    expect(json.sessions).toEqual(sessionRows);
    expect(json.distribution).toEqual(distRows);
    expect(json.total).toBe(1);
  });

  it('returns empty results (not 500) when D1 throws', async () => {
    const env = makeEnv({
      DB: {
        prepare: jest.fn(() => ({
          bind: () => ({
            all: jest.fn(async () => {
              throw new Error('D1 down');
            }),
          }),
        })),
      } as unknown as D1Database,
    });
    mockAssertSiteOwned.mockResolvedValue(true);
    mockIsFlagOn.mockResolvedValue(true);
    const res = await get(makeApp(AUTH), env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { sessions: unknown[]; total: number };
    expect(json.sessions).toEqual([]);
    expect(json.total).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// GET /api/sites/:siteId/copilot/config  (admin)
// ════════════════════════════════════════════════════════════════════════════

describe('GET /api/sites/:siteId/copilot/config', () => {
  function get(app: Hono<{ Bindings: Env; Variables: Variables }>, env: Env) {
    return app.request('/api/sites/site-1/copilot/config', { method: 'GET' }, env, makeCtx());
  }

  it('returns 401 when unauthenticated', async () => {
    const res = await get(makeApp(), makeEnv());
    expect(res.status).toBe(401);
  });

  it('returns enabled=false by default when no override row exists', async () => {
    const env = makeEnv({ DB: makeDb({ first: () => null }) });
    mockAssertSiteOwned.mockResolvedValue(true);
    mockIsFlagOn.mockResolvedValue(true);
    const res = await get(makeApp(AUTH), env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { site_id: string; enabled: boolean };
    expect(json.site_id).toBe('site-1');
    expect(json.enabled).toBe(false);
  });

  it('returns the stored enabled flag from the override row', async () => {
    const env = makeEnv({ DB: makeDb({ first: () => ({ value_json: JSON.stringify({ enabled: true }) }) }) });
    mockAssertSiteOwned.mockResolvedValue(true);
    mockIsFlagOn.mockResolvedValue(true);
    const res = await get(makeApp(AUTH), env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { enabled: boolean };
    expect(json.enabled).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// PUT /api/sites/:siteId/copilot/config  (admin)
// ════════════════════════════════════════════════════════════════════════════

describe('PUT /api/sites/:siteId/copilot/config', () => {
  function put(app: Hono<{ Bindings: Env; Variables: Variables }>, env: Env, body: unknown) {
    return app.request(
      '/api/sites/site-1/copilot/config',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      env,
      makeCtx(),
    );
  }

  it('returns 401 when unauthenticated', async () => {
    const res = await put(makeApp(), makeEnv(), { enabled: true });
    expect(res.status).toBe(401);
  });

  it('returns 400 when the body fails Zod validation (missing enabled)', async () => {
    // zValidator runs before the handler, so the request need not be authed
    // for the 400 to fire — but we auth anyway to assert it is the body, not
    // the guard, that rejects.
    const env = makeEnv();
    mockAssertSiteOwned.mockResolvedValue(true);
    mockIsFlagOn.mockResolvedValue(true);
    const res = await put(makeApp(AUTH), env, {});
    expect(res.status).toBe(400);
  });

  it('returns 400 when enabled is not a boolean', async () => {
    const env = makeEnv();
    mockAssertSiteOwned.mockResolvedValue(true);
    mockIsFlagOn.mockResolvedValue(true);
    const res = await put(makeApp(AUTH), env, { enabled: 'yes' });
    expect(res.status).toBe(400);
  });

  it('returns 200 and persists the toggle on a valid request', async () => {
    let upsertArgs: unknown[] = [];
    const env = makeEnv({
      DB: makeDb({
        run: (_sql, args) => {
          upsertArgs = args;
          return { success: true };
        },
      }),
    });
    mockAssertSiteOwned.mockResolvedValue(true);
    mockIsFlagOn.mockResolvedValue(true);
    const res = await put(makeApp(AUTH), env, { enabled: true });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; site_id: string; enabled: boolean };
    expect(json).toMatchObject({ ok: true, site_id: 'site-1', enabled: true });
    // value_json carries the new toggle; set_by carries the authenticated user.
    expect(upsertArgs).toContain(JSON.stringify({ enabled: true }));
    expect(upsertArgs).toContain('user-1');
  });
});
