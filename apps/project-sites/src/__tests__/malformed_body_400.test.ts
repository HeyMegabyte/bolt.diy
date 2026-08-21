/**
 * Reliability boundary: a malformed JSON request body must be a clean 400, never
 * an unhandled 500. These authed `api.ts` handlers read the body with a bare
 * `(await c.req.json()) as {...}` cast (CLAUDE.md known-issue #10 drift) — on a
 * malformed body `c.req.json()` threw a SyntaxError that bubbled to the global
 * error handler as INTERNAL_ERROR (500), mis-blaming the server and adding
 * Sentry noise.
 *
 * Fix: `.catch(() => ({}))` on the read, so a malformed body collapses to `{}`
 * and the handler's existing required-field guard returns a 400 BEFORE any DB /
 * external call. (A systemic `SyntaxError → 400` in the error handler was
 * rejected — it would mask legitimate 500s from parsing CORRUPT SERVER-SIDE
 * stored data, e.g. `GET /api/agency/brand`; see progress.md gotchas.)
 *
 * Each route's field-guard fires before any binding is touched, so these need no
 * D1/KV/R2 mocks — only an auth context.
 */
import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { errorHandler } from '../middleware/error_handler.js';
import { api } from '../routes/api.js';
import { domains } from '../../libs/features/domains/handlers.js';

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

const env = { ENVIRONMENT: 'test' } as unknown as Env;

function postMalformed(path: string) {
  return app.request(
    path,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'this-is-not-json',
    },
    env,
  );
}

describe('malformed JSON body → 400 (not 500) on no-catch api.ts handlers', () => {
  it.each([
    ['/api/domains/register'],
    ['/api/sites/site-1/snapshots'],
    ['/api/sites/site-1/snapshots/revert'],
    ['/api/billing/usage'],
  ])('returns 400 for a malformed body to %s', async (path) => {
    const res = await postMalformed(path);
    expect(res.status).toBe(400);
  });
});
