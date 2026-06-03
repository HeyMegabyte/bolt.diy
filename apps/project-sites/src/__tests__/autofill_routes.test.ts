/**
 * Route coverage for `POST /api/sites/autofill` (convergence r5).
 *
 * Exercises the handler end-to-end through the real Hono app + the shared
 * {@link errorHandler}, mocking only the boundaries (Workers AI, KV, D1 audit).
 * Covers: auth 401, Zod 400, rate-limit 429, AI success with coercion, and the
 * AI-failure fallback that keeps the form unblocked.
 */

jest.mock('../services/audit.js', () => ({
  writeAuditLog: jest.fn().mockResolvedValue(undefined),
}));

import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { errorHandler } from '../middleware/error_handler.js';
import { autofill } from '../routes/autofill.js';
import { writeAuditLog } from '../services/audit.js';

const mockWriteAuditLog = writeAuditLog as jest.MockedFunction<typeof writeAuditLog>;

// ─── Boundary mocks ──────────────────────────────────────────────────────────

/** In-memory KV mock used to drive the per-user rate limiter. */
function makeKv(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    get: jest.fn(async (k: string) => store.get(k) ?? null),
    put: jest.fn(async (k: string, v: string) => {
      store.set(k, v);
    }),
    delete: jest.fn(async (k: string) => {
      store.delete(k);
    }),
    _store: store,
  };
}

/** Workers-AI mock that returns the given `response` string (or throws). */
function makeAi(response: string | null, opts: { throws?: boolean } = {}) {
  return {
    run: jest.fn(async () => {
      if (opts.throws) throw new Error('AI gateway 503');
      return { response: response ?? '' };
    }),
  };
}

function makeEnv(overrides: Partial<Record<string, unknown>> = {}): Env {
  return {
    ENVIRONMENT: 'test',
    DB: {} as D1Database,
    CACHE_KV: makeKv(),
    AI: makeAi('{}'),
    ...overrides,
  } as unknown as Env;
}

// ─── App harness ─────────────────────────────────────────────────────────────

/**
 * Build the app with a middleware that seeds the auth context vars the
 * handler reads (`userId`, `orgId`, `requestId`). Passing no vars simulates
 * an unauthenticated request.
 */
function makeApp(vars: Partial<Variables> = {}) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.onError(errorHandler);
  app.use('*', async (c, next) => {
    if (vars.userId) c.set('userId', vars.userId);
    if (vars.orgId) c.set('orgId', vars.orgId);
    if (vars.requestId) c.set('requestId', vars.requestId);
    await next();
  });
  app.route('/', autofill);
  return app;
}

/** Minimal ExecutionContext so the handler's `waitUntil(...)` audit call works. */
function makeCtx(): ExecutionContext {
  return {
    waitUntil: (_p: Promise<unknown>) => {},
    passThroughOnException: () => {},
  } as unknown as ExecutionContext;
}

function post(app: Hono<{ Bindings: Env; Variables: Variables }>, body: unknown, env: Env) {
  return app.request(
    '/api/sites/autofill',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    env,
    makeCtx(),
  );
}

const AUTH: Partial<Variables> = { userId: 'user-1', orgId: 'org-1', requestId: 'req-1' };

beforeEach(() => {
  jest.clearAllMocks();
});

describe('POST /api/sites/autofill', () => {
  // ── Auth ────────────────────────────────────────────────────────────────
  it('returns 401 when the request is unauthenticated', async () => {
    const env = makeEnv();
    const res = await post(makeApp(), { name: 'Apple' }, env);
    expect(res.status).toBe(401);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe('UNAUTHORIZED');
    // Must short-circuit before calling AI or writing an audit row.
    expect((env.AI as unknown as { run: jest.Mock }).run).not.toHaveBeenCalled();
    expect(mockWriteAuditLog).not.toHaveBeenCalled();
  });

  // ── Validation ──────────────────────────────────────────────────────────
  it('returns 400 when the body fails Zod validation (missing name)', async () => {
    const env = makeEnv();
    const res = await post(makeApp(AUTH), {}, env);
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe('BAD_REQUEST');
    expect((env.AI as unknown as { run: jest.Mock }).run).not.toHaveBeenCalled();
  });

  it('returns 400 when the body is not valid JSON', async () => {
    const env = makeEnv();
    const res = await makeApp(AUTH).request(
      '/api/sites/autofill',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'not-json' },
      env,
      makeCtx(),
    );
    expect(res.status).toBe(400);
  });

  // ── Happy path + coercion ─────────────────────────────────────────────────
  it('returns 200 with normalized, sanitized fields on a valid AI response', async () => {
    const aiPayload = JSON.stringify({
      name: 'Apple iTunes Store',
      description: '  Digital storefront for music and apps.  ',
      category: 'technology', // partial → normalizes to "Technology / SaaS"
      primary_url: 'apple.com', // scheme-less → normalizes to https origin
      suggested_subdomains: ['Apple Store!', 'apple-store', 'apple-store', 'xx'], // dupes + too-short dropped
      brand_colors: ['#000', 'not-a-color', '#1d1d1f'], // junk dropped
      tagline: 'Music, movies, and more',
      target_audience: 'Consumers worldwide.',
      business_address: null,
      phone: null,
      additional_context: null,
    });
    const env = makeEnv({ AI: makeAi('```json\n' + aiPayload + '\n```') });

    const res = await post(makeApp(AUTH), { name: 'Apple iTunes Store' }, env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: Record<string, unknown>;
      meta: { status: string; model: string };
    };

    expect(json.meta.status).toBe('ok');
    expect(json.data['name']).toBe('Apple iTunes Store');
    expect(json.data['description']).toBe('Digital storefront for music and apps.'); // trimmed
    expect(json.data['category']).toBe('Technology / SaaS'); // fuzzy-matched
    expect(json.data['primary_url']).toBe('https://apple.com'); // scheme added
    // dupes removed, "xx" (<3 chars) dropped, "Apple Store!" slugified to "apple-store" (dupe)
    expect(json.data['suggested_subdomains']).toEqual(['apple-store']);
    // "#000" stays "#000", invalid dropped, "#1d1d1f" kept
    expect(json.data['brand_colors']).toEqual(['#000', '#1d1d1f']);

    // Audit log is fire-and-forget but must be scheduled.
    expect(mockWriteAuditLog).toHaveBeenCalledTimes(1);
    expect(mockWriteAuditLog.mock.calls[0][1]).toMatchObject({
      action: 'site.autofill.requested',
      org_id: 'org-1',
      actor_id: 'user-1',
    });
  });

  it('drops a placeholder primary_url and an out-of-list category to null', async () => {
    const aiPayload = JSON.stringify({
      name: 'Mystery Co',
      primary_url: 'https://your-domain.example',
      category: 'Banking Conglomerate', // not in CATEGORIES
    });
    const env = makeEnv({ AI: makeAi(aiPayload) });
    const res = await post(makeApp(AUTH), { name: 'Mystery Co' }, env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: Record<string, unknown> };
    expect(json.data['primary_url']).toBeNull();
    expect(json.data['category']).toBeNull();
  });

  // ── AI failure fallback ───────────────────────────────────────────────────
  it('returns 200 with an all-null fallback (status=error) when the AI call throws', async () => {
    const env = makeEnv({ AI: makeAi(null, { throws: true }) });
    const res = await post(makeApp(AUTH), { name: 'BrokenAI Inc' }, env);
    expect(res.status).toBe(200); // never crashes the form
    const json = (await res.json()) as {
      data: Record<string, unknown>;
      meta: { status: string };
    };
    expect(json.meta.status).toBe('error');
    expect(json.data['name']).toBe('BrokenAI Inc');
    expect(json.data['description']).toBeNull();
    expect(json.data['category']).toBeNull();
    expect(json.data['brand_colors']).toBeNull();
  });

  it('returns an all-null payload when the AI returns unparseable text', async () => {
    const env = makeEnv({ AI: makeAi('the model went rogue and wrote prose') });
    const res = await post(makeApp(AUTH), { name: 'Garbled' }, env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: Record<string, unknown>;
      meta: { status: string };
    };
    expect(json.meta.status).toBe('ok'); // call succeeded; output was just empty
    expect(json.data['name']).toBe('Garbled');
    expect(json.data['description']).toBeNull();
  });

  // ── Rate limit ────────────────────────────────────────────────────────────
  it('returns 429 with Retry-After when the per-user rate limit is already set', async () => {
    // Pre-seed the KV key the limiter checks for user-1.
    const env = makeEnv({ CACHE_KV: makeKv({ 'rl:autofill:user-1': '1' }) });
    const res = await post(makeApp(AUTH), { name: 'Apple' }, env);
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('10');
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe('RATE_LIMITED');
    // Rate-limited before the AI call.
    expect((env.AI as unknown as { run: jest.Mock }).run).not.toHaveBeenCalled();
  });

  it('allows the call when KV is unavailable (fail-open)', async () => {
    const brokenKv = {
      get: jest.fn(async () => {
        throw new Error('KV down');
      }),
      put: jest.fn(async () => {
        throw new Error('KV down');
      }),
    };
    const env = makeEnv({ CACHE_KV: brokenKv, AI: makeAi('{}') });
    const res = await post(makeApp(AUTH), { name: 'Apple' }, env);
    expect(res.status).toBe(200); // fail-open, not blocked
    expect((env.AI as unknown as { run: jest.Mock }).run).toHaveBeenCalledTimes(1);
  });
});
