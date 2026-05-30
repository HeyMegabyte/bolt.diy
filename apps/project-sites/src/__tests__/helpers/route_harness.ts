/**
 * @module __tests__/helpers/route_harness
 * @description Reusable harness for route-LAYER tests of feature-module Hono
 * apps — exercises the full path (auth context → requireOrgFlag → isFlagOn →
 * handler → service) via Hono's `app.request()`, no running server.
 *
 * The trick: `resolveFlag` reads `CACHE_KV.get(key, 'json')` first, so a mock KV
 * that returns an enabled FlagState makes the flag resolve ON without mocking
 * any module. A KV returning null + a DB with no override row resolves to the
 * registry default (off) — exercising the 404 path too.
 *
 * NOT a test suite itself (no `.test` suffix) — a helper imported by suites.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../../types/env.js';

/** A KV double whose `get(_, 'json')` returns an enabled flag (or null = use DB/default). */
export function flagKv(on: boolean) {
  return {
    // Key-aware: only `flag:*` keys resolve to a flag state. Other KV consumers
    // (e.g. rate-limit counters under `rl:*`) get null, so they behave normally.
    get: async (key: string) =>
      on && String(key).startsWith('flag:')
        ? { enabled: true, rollout_percent: 100, stage: 'beta', source: 'override' }
        : null,
    put: async () => undefined,
  } as unknown as KVNamespace;
}

/** Build a test Env from a mock D1 + a flag-on/off toggle. */
export function harnessEnv(db: unknown, flagOn: boolean): Env {
  return { DB: db, CACHE_KV: flagKv(flagOn) } as unknown as Env;
}

/**
 * Wrap a feature sub-app in a parent that injects auth context (the real auth
 * middleware does this in prod). Omit `ids` to simulate an unauthenticated call.
 *
 * @param sub - The feature module's exported Hono app.
 * @param ids - `{ userId, orgId }` to inject; omit for the unauthenticated case.
 * @returns A Hono app ready for `app.request(path, init, env)`.
 */
export function authApp(
  sub: Hono<{ Bindings: Env; Variables: Variables }>,
  ids?: { userId?: string; orgId?: string },
) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use('*', async (c, next) => {
    if (ids?.userId) c.set('userId', ids.userId);
    if (ids?.orgId) c.set('orgId', ids.orgId);
    c.set('requestId', 'test-req');
    await next();
  });
  app.route('/', sub);
  return app;
}
