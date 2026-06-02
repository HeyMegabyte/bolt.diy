/**
 * @module __tests__/trace-explain
 * @description Tests for `POST /api/admin/traces/:traceId/explain` (item #91).
 *
 * Verifies that:
 *  1. Auth is required (401 without orgId).
 *  2. A missing trace returns 404.
 *  3. The LLM is called with the SRE system prompt + trace JSON, and the
 *     markdown response flows back to the caller.
 *  4. A 2nd call for the same trace hits the KV cache (no second AI call).
 */

jest.mock('../services/db.js', () => ({
  dbQuery: jest.fn().mockResolvedValue({ data: [], error: null }),
  dbQueryOne: jest.fn(),
  dbInsert: jest.fn().mockResolvedValue({ error: null }),
  dbUpdate: jest.fn().mockResolvedValue({ error: null, changes: 1 }),
  dbExecute: jest.fn().mockResolvedValue({ error: null, changes: 1 }),
}));
jest.mock('../lib/sentry.js', () => ({ captureError: jest.fn(), captureMessage: jest.fn(), createSentry: jest.fn() }));
jest.mock('../lib/posthog.js', () => ({ capture: jest.fn(), trackAuth: jest.fn(), trackSite: jest.fn(), trackError: jest.fn() }));

import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { errorHandler } from '../middleware/error_handler.js';
import { aiAdmin } from '../routes/ai_admin.js';

const ORG_ID = 'org-1';
const TRACE_ID = 'trace-1';

interface KvStub {
  store: Map<string, string>;
  get: jest.Mock;
  put: jest.Mock;
  delete: jest.Mock;
}

function makeKv(): KvStub {
  const store = new Map<string, string>();
  const get = jest.fn(async (k: string) => store.get(k) ?? null);
  const put = jest.fn(async (k: string, v: string) => {
    store.set(k, v);
  });
  const delete_ = jest.fn(async (k: string) => {
    store.delete(k);
  });
  return { store, get, put, delete: delete_ };
}

interface PreparedStmt {
  bind: (...args: unknown[]) => {
    first: () => Promise<unknown>;
    all: () => Promise<unknown>;
    run: () => Promise<unknown>;
  };
}

function makeDb(traceRow: Record<string, unknown> | null): D1Database {
  return {
    prepare: jest.fn(
      (): PreparedStmt => ({
        bind: () => ({
          first: jest.fn().mockResolvedValue(traceRow),
          all: jest.fn().mockResolvedValue({ results: [], success: true }),
          // The handler persists the generated explanation to D1 (L1 cache)
          // via `UPDATE … SET explanation = ?`.bind(…).run() — mock it so the
          // cold path doesn't throw on a missing `.run`.
          run: jest.fn().mockResolvedValue({ success: true, meta: {} }),
        }),
      }),
    ),
  } as unknown as D1Database;
}

function makeEnv(opts: { traceRow: Record<string, unknown> | null; aiResponse: string; kv: KvStub }): Env {
  return {
    DB: makeDb(opts.traceRow),
    CACHE_KV: opts.kv as unknown as KVNamespace,
    AI: { run: jest.fn().mockResolvedValue({ response: opts.aiResponse }) } as unknown as Ai,
    ENVIRONMENT: 'test',
  } as unknown as Env;
}

function authedApp() {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.onError(errorHandler);
  app.use('*', async (c, next) => {
    c.set('orgId', ORG_ID);
    c.set('userId', 'user-1');
    c.set('requestId', 'req-1');
    await next();
  });
  app.route('/', aiAdmin);
  return app;
}

beforeEach(() => jest.clearAllMocks());

describe('POST /api/admin/traces/:traceId/explain', () => {
  it('rejects unauthenticated requests with 401', async () => {
    const app = new Hono<{ Bindings: Env; Variables: Variables }>();
    app.onError(errorHandler);
    app.route('/', aiAdmin);
    const env = makeEnv({ traceRow: null, aiResponse: '', kv: makeKv() });
    const res = await app.request(`/api/admin/traces/${TRACE_ID}/explain`, { method: 'POST' }, env);
    expect(res.status).toBe(401);
  });

  it('returns 404 when the trace does not exist for the org', async () => {
    const env = makeEnv({ traceRow: null, aiResponse: 'x', kv: makeKv() });
    const res = await authedApp().request(
      `/api/admin/traces/${TRACE_ID}/explain`,
      { method: 'POST' },
      env,
    );
    expect(res.status).toBe(404);
  });

  it('returns the LLM markdown and caches it on second call', async () => {
    const kv = makeKv();
    const traceRow = {
      id: TRACE_ID,
      trace_kind: 'endpoint',
      endpoint_slug: 'lead-qualifier',
      model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
      status: 'error',
      prompt_template: 'You are a lead qualifier…',
      input_json: '{"email":"a@b.com"}',
      output_text: null,
      error_message: 'rate_limited',
      latency_ms: 42,
      tokens_input: 100,
      tokens_output: 0,
      created_at: '2026-05-21T12:00:00Z',
    };
    const env = makeEnv({ traceRow, aiResponse: '**Failed**\n\nUpstream rate limit.', kv });
    const app = authedApp();
    // The success path schedules D1-persist + audit-log via executionCtx.waitUntil,
    // so a request without an ExecutionContext throws. Provide a no-op stub.
    const execCtx = {
      waitUntil: () => undefined,
      passThroughOnException: () => undefined,
    } as unknown as ExecutionContext;
    const res1 = await app.request(
      `/api/admin/traces/${TRACE_ID}/explain`,
      { method: 'POST' },
      env,
      execCtx,
    );
    expect(res1.status).toBe(200);
    const body1 = (await res1.json()) as { data: { markdown: string; cached: boolean; model: string } };
    expect(body1.data.markdown).toContain('Failed');
    expect(body1.data.cached).toBe(false);
    expect(body1.data.model).toBe('@cf/meta/llama-3.1-8b-instruct-fp8');
    expect(env.AI.run).toHaveBeenCalledTimes(1);
    // System prompt assertions
    const callArgs = (env.AI.run as jest.Mock).mock.calls[0]!;
    expect(callArgs[0]).toBe('@cf/meta/llama-3.1-8b-instruct-fp8');
    const messages = callArgs[1].messages as Array<{ role: string; content: string }>;
    expect(messages[0]!.role).toBe('system');
    expect(messages[0]!.content).toContain('SRE assistant');
    expect(messages[1]!.content).toContain(TRACE_ID);

    // 2nd call → cache hit, no extra AI invocation
    const res2 = await app.request(
      `/api/admin/traces/${TRACE_ID}/explain`,
      { method: 'POST' },
      env,
      execCtx,
    );
    expect(res2.status).toBe(200);
    const body2 = (await res2.json()) as { data: { markdown: string; cached: boolean } };
    expect(body2.data.cached).toBe(true);
    expect(body2.data.markdown).toContain('Failed');
    expect(env.AI.run).toHaveBeenCalledTimes(1);
  });
});
