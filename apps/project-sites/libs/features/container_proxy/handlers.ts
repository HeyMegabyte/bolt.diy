/**
 * @module libs/features/container_proxy/handlers
 *
 * @description
 * Hono routes the **build container** calls back into over the public worker URL
 * when outbound handlers aren't available: upload a file to R2, run a
 * parameterized D1 query, and fetch the container build-server bootstrap script.
 * All three are authenticated by a **shared secret** (`x-container-secret` ===
 * first 16 chars of `ANTHROPIC_API_KEY`) via {@link containerAuthorized}, NOT by
 * an org session — they are machine-to-machine endpoints for the container.
 *
 * | Method | Path                     | Auth             | Purpose                                    |
 * | ------ | ------------------------ | ---------------- | ------------------------------------------ |
 * | PUT    | /api/container-upload/*  | container-secret | Upload a file to the sites R2 bucket       |
 * | POST   | /api/container-query     | container-secret | Execute a parameterized D1 statement       |
 * | GET    | /api/container-script    | (public)         | Serve `container/build-server.js` from R2  |
 *
 * Extracted VERBATIM from the `search.ts` monolith (route-decomposition
 * installment 22) — only the route-registration receiver changed (`search.` →
 * `containerProxy.`). The `containerAuthorized` guard moved with the routes (it
 * was exclusive to them), so its `timingSafeEqual` import moved here and left
 * search.ts. The AUTH-BYPASS guard in `containerAuthorized` (the `!!expected`
 * check — see its JSDoc) is preserved byte-for-byte; do NOT weaken it. No
 * `onError` (routes return explicit JSON / bubble to the app handler as before).
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import { timingSafeEqual } from '@project-sites/shared';
import type { Env, Variables } from '../../../src/types/env.js';

type AppContext = { Bindings: Env; Variables: Variables };

/**
 * Authorize a build-container request against the shared secret
 * (`x-container-secret` === first 16 chars of `ANTHROPIC_API_KEY`).
 *
 * Requires BOTH sides present + a constant-time compare. If `ANTHROPIC_API_KEY`
 * is unset, `?.slice` yields `undefined`; a header-less request would then
 * compare `undefined !== undefined` → false → the 401 gets SKIPPED, opening
 * arbitrary R2 writes + SQL execution unauthenticated. The `!!expected` guard
 * closes that AUTH BYPASS (no length/timing oracle).
 */
function containerAuthorized(env: Env, secretHeader: string | undefined): boolean {
  const expected = env.ANTHROPIC_API_KEY?.slice(0, 16);
  return !!expected && !!secretHeader && timingSafeEqual(secretHeader, expected);
}

export const containerProxy = new Hono<AppContext>();

/**
 * Container upload endpoint — allows the build container to upload files to R2
 * via the public worker URL when outbound handlers aren't available.
 * Authenticated via a shared secret passed in the build payload.
 */
containerProxy.put('/api/container-upload/*', async (c) => {
  if (!containerAuthorized(c.env, c.req.header('x-container-secret'))) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  const key = c.req.path.replace('/api/container-upload/', '');
  if (!key || key.includes('..')) return c.json({ error: 'Invalid key' }, 400);

  const body = await c.req.arrayBuffer();
  const ct = c.req.header('content-type') || 'application/octet-stream';
  await c.env.SITES_BUCKET.put(key, body, { httpMetadata: { contentType: ct } });
  return c.json({ ok: true, key });
});

/**
 * Container D1 query endpoint — allows the build container to execute
 * parameterized SQL via the public worker URL.
 */
containerProxy.post('/api/container-query', async (c) => {
  if (!containerAuthorized(c.env, c.req.header('x-container-secret'))) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json({ error: 'invalid JSON body' }, 400);
  }
  const body = raw as { sql?: unknown; params?: unknown };
  if (typeof body.sql !== 'string' || body.sql.length === 0) {
    return c.json({ error: 'sql (non-empty string) required' }, 400);
  }
  const params = Array.isArray(body.params) ? body.params : undefined;
  const stmt = c.env.DB.prepare(body.sql);
  const result = params ? await stmt.bind(...params).run() : await stmt.run();
  return c.json({ ok: true, meta: result.meta });
});

/** Serve the container build server script from R2 (used by container entrypoint bootstrap). */
containerProxy.get('/api/container-script', async (c) => {
  const obj = await c.env.SITES_BUCKET.get('container/build-server.js');
  if (!obj) {
    return c.text('// build-server.js not found in R2', 404);
  }
  return new Response(await obj.text(), {
    headers: { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-cache' },
  });
});
