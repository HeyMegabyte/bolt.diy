/**
 * Central malformed-JSON safety net.
 *
 * A bare `await c.req.json()` on a handler that doesn't individually guard the
 * parse throws a `SyntaxError`, which previously fell through to the
 * `INTERNAL_ERROR` 500 branch — surfacing a CLIENT error (malformed body) as a
 * SERVER fault AND polluting Sentry/PostHog with a fake internal error.
 *
 * The error handler now maps any JSON-parse `SyntaxError` to a clean
 * `400 BAD_REQUEST` (logged at warn, NOT reported to Sentry), so every one of
 * the ~30 un-individually-guarded `c.req.json()` reads — and every future one —
 * is safe by default. Precision: a non-JSON `SyntaxError` still maps to 500.
 */

jest.mock('../lib/posthog.js', () => ({ trackError: jest.fn() }));

import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { errorHandler } from '../middleware/error_handler.js';
import * as posthog from '../lib/posthog.js';

const mockCapture = posthog.trackError as jest.MockedFunction<typeof posthog.trackError>;

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.onError(errorHandler);
app.use('*', async (c, next) => {
  c.set('requestId', 'req-1');
  await next();
});
// A handler that reads the body with NO individual guard (the 500-class).
app.post('/bare', async (c) => {
  const body = await c.req.json();
  return c.json({ ok: true, body });
});
// A handler that throws a SyntaxError unrelated to JSON parsing (precision check).
app.post('/other-syntax', async () => {
  throw new SyntaxError('Cannot use import statement outside a module');
});

function post(path: string, body?: string) {
  return app.request(
    path,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body },
    {} as Env,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('error handler — malformed JSON safety net', () => {
  it('maps a malformed JSON body to 400 BAD_REQUEST (never 500)', async () => {
    const res = await post('/bare', '{ not valid json');
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('BAD_REQUEST');
  });

  it('does NOT report a malformed body to PostHog (it is a client error)', async () => {
    await post('/bare', '{ broken');
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it('still serves a valid JSON body normally', async () => {
    const res = await post('/bare', JSON.stringify({ a: 1 }));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; body: { a: number } };
    expect(json.ok).toBe(true);
    expect(json.body.a).toBe(1);
  });

  it('keeps a non-JSON SyntaxError on the 500 path (precision — no over-masking)', async () => {
    const res = await post('/other-syntax');
    expect(res.status).toBe(500);
    // The 500 path emits an unconditional structured INTERNAL_ERROR log line —
    // proof the SyntaxError was reported, not silently masked down to a 400.
    const warned = (console.warn as jest.Mock).mock.calls.map(String).join(' ');
    expect(warned).toContain('INTERNAL_ERROR');
  });
});
