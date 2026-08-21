/**
 * Regression: the GET /api/domains/suggest query schema MUST accept BOTH
 * site-PK formats — UUID rows and legacy slug-style ids (`site-megabytespace-001`,
 * `e2e-site-1`). The former `.uuid()` gate 400'd every slug-id site's domain
 * picker (Brian click-around finding 2026-08-20). Ownership stays the real
 * gate; shape validation must never be stricter than the DB's own PK set.
 *
 * Harness mirrors api_malformed_json_authed_boundary.test.ts: bare Hono app +
 * errorHandler + an orgId-setting middleware — the suggest routes only need
 * orgId (they 404 later on the mocked empty site lookup, which is NOT a 400).
 */
import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { errorHandler } from '../middleware/error_handler.js';
import { api } from '../routes/api.js';
import { domains } from '../../libs/features/domains/handlers.js';

const mockDb = {
  prepare: jest.fn(() => ({
    bind: jest.fn(() => ({
      first: jest.fn().mockResolvedValue(null),
      all: jest.fn().mockResolvedValue({ results: [] }),
      run: jest.fn().mockResolvedValue({}),
    })),
  })),
} as unknown as D1Database;

function makeEnv(): Env {
  return { ENVIRONMENT: 'test', DB: mockDb } as unknown as Env;
}

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.onError(errorHandler);
app.use('*', async (c, next) => {
  c.set('orgId', 'org-1');
  c.set('userId', 'user-1');
  c.set('requestId', 'req-1');
  await next();
});
app.route('/', domains);
app.route('/', api);

beforeEach(() => jest.spyOn(console, 'warn').mockImplementation(() => {}));
afterEach(() => jest.restoreAllMocks());

describe('GET /api/domains/suggest — site_id shape validation', () => {
  const get = (query: string) =>
    app.request(`/api/domains/suggest${query}`, { method: 'GET' }, makeEnv());

  test('slug-style site id (site-megabytespace-001) is NOT a 400 VALIDATION_ERROR', async () => {
    const res = await get('?site_id=site-megabytespace-001&count=10');
    expect(res.status).not.toBe(400);
  });

  test('e2e-style site id (e2e-site-1) is NOT a 400 VALIDATION_ERROR', async () => {
    const res = await get('?site_id=e2e-site-1&count=5');
    expect(res.status).not.toBe(400);
  });

  test('UUID site id still passes shape validation', async () => {
    const res = await get('?site_id=d8ab2ec9-9e05-4aeb-adbb-5b6216007203&count=10');
    expect(res.status).not.toBe(400);
  });

  test('path-traversal garbage still 400s (injection guard intact)', async () => {
    const res = await get('?site_id=../../etc/passwd');
    expect(res.status).toBe(400);
  });
});

describe('POST /api/domains/suggest/refine — site_id shape validation', () => {
  const post = (siteId: string) =>
    app.request(
      '/api/domains/suggest/refine',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ site_id: siteId, count: 10, exclude_domains: ['a.com'] }),
      },
      makeEnv(),
    );

  test('slug-style site id is NOT a 400 VALIDATION_ERROR', async () => {
    const res = await post('site-megabytespace-001');
    expect(res.status).not.toBe(400);
  });

  test('garbage with slashes still 400s', async () => {
    const res = await post('foo/bar baz');
    expect(res.status).toBe(400);
  });
});
