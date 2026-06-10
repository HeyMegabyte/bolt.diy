/**
 * `PATCH /api/sites/:id` is the last no-`.catch()` `as`-cast body reader in
 * api.ts (CLAUDE.md known-issue #10). Unlike the fire-16 handlers it has NO
 * required field — every field is optional — so a valid empty `{}` body is a
 * legitimate 200 no-op (`{ updated: false }`). The bug is narrower: a MALFORMED
 * JSON body threw a SyntaxError → unhandled 500.
 *
 * Fix uses `.catch(() => null)` + a null-guard (NOT `.catch(() => ({}))`, which
 * would mask a malformed body as the valid empty no-op): malformed → 400, valid
 * empty `{}` → 200 no-op preserved.
 */
import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { errorHandler } from '../middleware/error_handler.js';
import { api } from '../routes/api.js';

const mockDb = {
  prepare: jest.fn((sql: string) => {
    const isSites = /FROM sites/i.test(sql);
    const row = isSites ? { id: 'site-1', slug: 'nsk', org_id: 'org-1' } : null;
    return {
      bind: jest.fn(() => ({
        first: jest.fn().mockResolvedValue(row),
        all: jest.fn().mockResolvedValue({ results: row ? [row] : [] }),
        run: jest.fn().mockResolvedValue({}),
      })),
    };
  }),
} as unknown as D1Database;

const env = { ENVIRONMENT: 'test', DB: mockDb } as unknown as Env;

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.onError(errorHandler);
app.use('*', async (c, next) => {
  c.set('orgId', 'org-1');
  c.set('userId', 'user-1');
  c.set('requestId', 'req-1');
  await next();
});
app.route('/', api);

function patch(body: unknown, rawBody?: string) {
  return app.request(
    '/api/sites/site-1',
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: rawBody !== undefined ? rawBody : JSON.stringify(body),
    },
    env,
  );
}

afterEach(() => jest.clearAllMocks());

describe('PATCH /api/sites/:id — malformed body boundary', () => {
  it('returns 400 (not 500) on a malformed JSON body', async () => {
    const res = await patch(undefined, 'not-json');
    expect(res.status).toBe(400);
  });

  it('preserves the valid empty-object no-op (200, updated:false)', async () => {
    const res = await patch({});
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { updated: boolean } };
    expect(json.data.updated).toBe(false);
  });
});
