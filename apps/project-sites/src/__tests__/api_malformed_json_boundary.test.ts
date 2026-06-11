/**
 * Input-boundary coverage for the PUBLIC + payment + auth POST handlers in
 * `routes/api.ts` that read the body with a bare `await c.req.json()` (no
 * `.catch()`). A malformed JSON body throws an uncaught SyntaxError at the
 * parse, which the error handler maps to a 500 — so an anonymous caller sending
 * garbage gets a server-error (and a Sentry event) on a public surface instead
 * of a clean client 400.
 *
 * Each handler immediately `SomeSchema.parse(body)`s (or hands the body to a
 * service that does), and every schema has required fields — so routing a
 * malformed body through `.catch(() => ({}))` lands it on the SAME ZodError→400
 * path a wrong-shape body already takes. These tests assert 400 (not 500) on a
 * malformed body across the cluster. Mirrors `domain_purchase_route.test.ts`.
 *
 * Per the fire-16 lesson, this is a PER-HANDLER request-body fix (a malformed
 * REQUEST body IS a client 400) — never the reverted global SyntaxError→400 map
 * (which wrongly swallows corrupt SERVER-side data parses as 400).
 */
import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { errorHandler } from '../middleware/error_handler.js';
import { api } from '../routes/api.js';

const mockDb = {
  prepare: jest.fn(() => ({
    bind: jest.fn(() => ({
      first: jest.fn().mockResolvedValue({ email: 'a@b.com' }),
      all: jest.fn().mockResolvedValue({ results: [] }),
      run: jest.fn().mockResolvedValue({}),
    })),
  })),
} as unknown as D1Database;

function makeEnv(): Env {
  return { ENVIRONMENT: 'test', DB: mockDb, STRIPE_SECRET_KEY: 'sk_test_x' } as unknown as Env;
}

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.onError(errorHandler);
app.use('*', async (c, next) => {
  c.set('orgId', 'org-1');
  c.set('userId', 'user-1');
  c.set('requestId', 'req-1');
  await next();
});
app.route('/', api);

function postRaw(path: string, raw: string) {
  return app.request(
    path,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: raw },
    makeEnv(),
  );
}

beforeEach(() => jest.spyOn(console, 'warn').mockImplementation(() => {}));
afterEach(() => jest.restoreAllMocks());

describe('routes/api.ts — malformed JSON body → 400 (not 500)', () => {
  const endpoints = [
    '/api/auth/magic-link',
    '/api/auth/magic-link/verify',
    '/api/billing/checkout',
    '/api/billing/embedded-checkout',
    '/api/billing/payment-intent',
    '/api/contact',
  ];

  it.each(endpoints)('POST %s with a malformed body returns a 4xx, never a 500', async (path) => {
    const res = await postRaw(path, '{ this is : not json');
    expect(res.status).not.toBe(500);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it.each(endpoints)('POST %s with an empty {} body also returns a 4xx (required fields)', async (path) => {
    const res = await postRaw(path, '{}');
    expect(res.status).not.toBe(500);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
});
