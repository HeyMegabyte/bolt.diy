/**
 * @module __tests__/endpoint-suggest
 * @description Tests for `POST /api/sites/:siteId/ai-endpoints/suggest` (item #93).
 *
 * Verifies that:
 *  1. Auth is required (401).
 *  2. A short description is rejected with 400.
 *  3. The LLM JSON is parsed + Zod-validated and the suggestion comes back.
 *  4. Invalid LLM output → 502 (the schema rejects an empty `files` map / bad slug).
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
const SITE_ID = 'site-1';

function makeDb(siteRow: Record<string, unknown> | null): D1Database {
  return {
    prepare: jest.fn(() => ({
      bind: () => ({
        first: jest.fn().mockResolvedValue(siteRow),
        all: jest.fn().mockResolvedValue({ results: [], success: true }),
      }),
    })),
  } as unknown as D1Database;
}

function makeEnv(aiResponse: string, siteRow: Record<string, unknown> | null): Env {
  return {
    DB: makeDb(siteRow),
    CACHE_KV: { get: jest.fn(), put: jest.fn(), delete: jest.fn() },
    AI: { run: jest.fn().mockResolvedValue({ response: aiResponse }) } as unknown as Ai,
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

const SITE_ROW = { slug: 'vitos', business_name: "Vito's Mens Salon" };

beforeEach(() => jest.clearAllMocks());

describe('POST /api/sites/:siteId/ai-endpoints/suggest', () => {
  it('rejects unauthenticated requests with 401', async () => {
    const app = new Hono<{ Bindings: Env; Variables: Variables }>();
    app.onError(errorHandler);
    app.route('/', aiAdmin);
    const env = makeEnv('{}', SITE_ROW);
    const res = await app.request(
      `/api/sites/${SITE_ID}/ai-endpoints/suggest`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ description: 'lead qualifier' }),
      },
      env,
    );
    expect(res.status).toBe(401);
  });

  it('rejects short descriptions with 400', async () => {
    const env = makeEnv('{}', SITE_ROW);
    const res = await authedApp().request(
      `/api/sites/${SITE_ID}/ai-endpoints/suggest`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ description: 'hi' }),
      },
      env,
    );
    expect(res.status).toBe(400);
  });

  it('returns the validated suggestion when the LLM responds with valid JSON', async () => {
    const llm = JSON.stringify({
      slug: 'lead-qualifier',
      method: 'POST',
      language: 'ai-prompt',
      files: { 'prompt.md': 'You are a lead qualifier…' },
      description: 'Score inbound leads on a 0-100 scale.',
    });
    const env = makeEnv(llm, SITE_ROW);
    const res = await authedApp().request(
      `/api/sites/${SITE_ID}/ai-endpoints/suggest`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ description: 'qualify and score inbound leads' }),
      },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { slug: string; method: string; language: string; files: Record<string, string>; description: string };
    };
    expect(body.data.slug).toBe('lead-qualifier');
    expect(body.data.method).toBe('POST');
    expect(body.data.language).toBe('ai-prompt');
    expect(Object.keys(body.data.files)).toContain('prompt.md');
    // System prompt assertion
    const args = (env.AI.run as jest.Mock).mock.calls[0]!;
    expect(args[0]).toBe('@cf/meta/llama-3.1-8b-instruct-fp8');
    expect(args[1].messages[0].content).toContain('STRICT JSON');
  });

  it('returns 502 when the LLM emits invalid JSON', async () => {
    const env = makeEnv('not even json {', SITE_ROW);
    const res = await authedApp().request(
      `/api/sites/${SITE_ID}/ai-endpoints/suggest`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ description: 'qualify leads' }),
      },
      env,
    );
    expect(res.status).toBe(502);
  });
});
