/**
 * Input-boundary coverage for the AUTHED site-data upsert
 * `PUT /api/sites/:siteId/data/:table/:rowId` (`routes/search.ts`). Unlike the
 * other body handlers, this one is a DATA-INTEGRITY bug, not just reliability:
 *   - it read the body with a bare `await c.req.json()` → a malformed body
 *     threw an uncaught SyntaxError → 500
 *   - it wrote `JSON.stringify(body.data || body)` with NO validation, so a
 *     malformed-or-empty body would silently overwrite the row's `data_json`
 *     with `"{}"` and return `{ updated: true }` — clobbering real site data
 *     (a menu item, gallery entry, FAQ) on garbage input
 *
 * The fix reads with `.catch(() => null)` and rejects a non-object body with a
 * 400 BEFORE the write — so a malformed body can never silently clobber a row.
 * A well-formed object body (including an intentional empty `{}` "clear") still
 * writes. NOT a blind `.catch(() => ({}))` (that would preserve the silent
 * clobber) — this needs the explicit guard.
 */
import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { errorHandler } from '../middleware/error_handler.js';
import { search } from '../routes/search.js';

let lastRun: { sql: string; binds: unknown[] } | null = null;
const mockDb = {
  prepare: jest.fn((sql: string) => ({
    bind: jest.fn((...binds: unknown[]) => ({
      run: jest.fn(async () => {
        lastRun = { sql, binds };
        return {};
      }),
      all: jest.fn().mockResolvedValue({ results: [] }),
      first: jest.fn().mockResolvedValue(null),
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
app.route('/', search);

const PATH = '/api/sites/site-1/data/menu_items/row-1';
function put(raw: string) {
  return app.request(
    PATH,
    { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: raw },
    makeEnv(),
  );
}

beforeEach(() => {
  lastRun = null;
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('PUT /api/sites/:siteId/data/:table/:rowId — body integrity', () => {
  it('rejects a malformed JSON body with a 400 and does NOT write', async () => {
    const res = await put('{ not : valid json');
    expect(res.status).toBe(400);
    expect(lastRun).toBeNull(); // never reached the INSERT/UPDATE
  });

  it('rejects a non-object JSON body (e.g. a bare string) with a 400 and does NOT write', async () => {
    const res = await put('"just a string"');
    expect(res.status).toBe(400);
    expect(lastRun).toBeNull();
  });

  it('still upserts a well-formed object body', async () => {
    const res = await put(JSON.stringify({ data: { name: 'Espresso', price: 3 }, sort_order: 2 }));
    expect(res.status).toBe(200);
    expect(lastRun).not.toBeNull();
    expect(String(lastRun?.binds?.[3])).toContain('Espresso');
  });
});
