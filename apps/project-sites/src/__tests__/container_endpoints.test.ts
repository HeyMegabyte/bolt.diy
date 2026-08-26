/**
 * Tests for the container upload/query endpoints.
 * These endpoints allow the build container to write to R2 and D1
 * via the public Worker URL when outbound handlers are unavailable.
 */

jest.mock('../services/db.js', () => ({
  dbQuery: jest.fn().mockResolvedValue({ data: [], error: null }),
  dbQueryOne: jest.fn().mockResolvedValue(null),
  dbInsert: jest.fn().mockResolvedValue({ error: null }),
  dbUpdate: jest.fn().mockResolvedValue({ error: null, changes: 1 }),
  dbExecute: jest.fn().mockResolvedValue({ error: null, changes: 1 }),
}));

jest.mock('../services/audit.js', () => ({
  writeAuditLog: jest.fn().mockResolvedValue(undefined),
}));

import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { errorHandler } from '../middleware/error_handler.js';
import { search } from '../routes/search.js';
// Route-decomposition installment 22: the /api/container-* build-container callbacks
// moved from search.ts to their own module. Mount it before search so the moved routes
// resolve here (mirrors src/index.ts).
import { containerProxy } from '../../libs/features/container_proxy/handlers.js';

const mockDb = {
  prepare: jest.fn().mockReturnValue({
    bind: jest.fn().mockReturnValue({
      run: jest.fn().mockResolvedValue({ meta: { changes: 1 } }),
    }),
    run: jest.fn().mockResolvedValue({ meta: { changes: 1 } }),
  }),
} as unknown as D1Database;

const mockSitesBucket = {
  get: jest.fn().mockResolvedValue(null),
  put: jest.fn().mockResolvedValue({}),
} as unknown as R2Bucket;

const MOCK_API_KEY = 'sk-test-1234567890abcdef';

const mockEnv = {
  GOOGLE_PLACES_API_KEY: 'test-google-key',
  ANTHROPIC_API_KEY: MOCK_API_KEY,
  ENVIRONMENT: 'test',
  DB: mockDb,
  SITES_BUCKET: mockSitesBucket,
  CACHE_KV: { get: jest.fn().mockResolvedValue(null), put: jest.fn() },
} as unknown as Env;

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.onError(errorHandler);
app.route('/', containerProxy);
app.route('/', search);

const originalFetch = global.fetch;
let mockFetch: jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockFetch = jest.fn().mockResolvedValue(new Response('', { status: 404 }));
  global.fetch = mockFetch;
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe('Container upload endpoint', () => {
  it('rejects requests without secret', async () => {
    const res = await app.request(
      '/api/container-upload/sites/test/file.html',
      {
        method: 'PUT',
        body: '<html>test</html>',
        headers: { 'Content-Type': 'text/html' },
      },
      mockEnv,
    );
    expect(res.status).toBe(401);
  });

  it('accepts requests with correct secret', async () => {
    const secret = MOCK_API_KEY.slice(0, 16);
    const res = await app.request(
      '/api/container-upload/sites/test/file.html',
      {
        method: 'PUT',
        body: '<html>test</html>',
        headers: {
          'Content-Type': 'text/html',
          'x-container-secret': secret,
        },
      },
      mockEnv,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.key).toBe('sites/test/file.html');

    // Verify R2 put was called
    expect(mockSitesBucket.put).toHaveBeenCalledWith(
      'sites/test/file.html',
      expect.anything(),
      expect.objectContaining({ httpMetadata: { contentType: 'text/html' } }),
    );
  });
});

describe('Container query endpoint', () => {
  it('rejects requests without secret', async () => {
    const res = await app.request(
      '/api/container-query',
      {
        method: 'POST',
        body: JSON.stringify({ sql: 'SELECT 1' }),
        headers: { 'Content-Type': 'application/json' },
      },
      mockEnv,
    );
    expect(res.status).toBe(401);
  });

  it('executes parameterized SQL with correct secret', async () => {
    const secret = MOCK_API_KEY.slice(0, 16);
    const res = await app.request(
      '/api/container-query',
      {
        method: 'POST',
        body: JSON.stringify({
          sql: 'UPDATE sites SET status = ?1 WHERE id = ?2',
          params: ['published', 'test-id'],
        }),
        headers: {
          'Content-Type': 'application/json',
          'x-container-secret': secret,
        },
      },
      mockEnv,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    // Verify D1 prepare was called
    expect(mockDb.prepare).toHaveBeenCalledWith('UPDATE sites SET status = ?1 WHERE id = ?2');
  });

  it('does NOT bypass auth when ANTHROPIC_API_KEY is unset (no header)', async () => {
    // Regression: `undefined !== undefined` previously skipped the 401, opening
    // unauthenticated SQL execution when the secret env was absent.
    const envNoKey = { ...(mockEnv as object), ANTHROPIC_API_KEY: undefined } as unknown as Env;
    const res = await app.request(
      '/api/container-query',
      {
        method: 'POST',
        body: JSON.stringify({ sql: 'DROP TABLE sites' }),
        headers: { 'Content-Type': 'application/json' },
      },
      envNoKey,
    );
    expect(res.status).toBe(401);
    expect(mockDb.prepare).not.toHaveBeenCalled();
  });

  it('returns 400 when sql is missing/non-string (authorized but malformed)', async () => {
    const res = await app.request(
      '/api/container-query',
      {
        method: 'POST',
        body: JSON.stringify({ params: [1] }),
        headers: {
          'Content-Type': 'application/json',
          'x-container-secret': MOCK_API_KEY.slice(0, 16),
        },
      },
      mockEnv,
    );
    expect(res.status).toBe(400);
    expect(mockDb.prepare).not.toHaveBeenCalled();
  });

  it('returns 400 (not 500) on a malformed JSON body', async () => {
    const res = await app.request(
      '/api/container-query',
      {
        method: 'POST',
        body: 'not-json',
        headers: {
          'Content-Type': 'application/json',
          'x-container-secret': MOCK_API_KEY.slice(0, 16),
        },
      },
      mockEnv,
    );
    expect(res.status).toBe(400);
    expect(mockDb.prepare).not.toHaveBeenCalled();
  });
});

describe('Container script endpoint', () => {
  it('serves the build server script from R2', async () => {
    (mockSitesBucket.get as jest.Mock).mockResolvedValueOnce({
      text: () => Promise.resolve('console.log("build server")'),
    });

    const res = await app.request('/api/container-script', {}, mockEnv);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('build server');
  });

  it('returns 404 when script not in R2', async () => {
    (mockSitesBucket.get as jest.Mock).mockResolvedValueOnce(null);

    const res = await app.request('/api/container-script', {}, mockEnv);
    expect(res.status).toBe(404);
  });
});
