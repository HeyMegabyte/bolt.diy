/**
 * @module inngest/request-env
 *
 * @description
 * Per-request `Env` propagation for the Inngest plane (§13). Cloudflare Workers
 * have no ambient `process.env`, and the `inngest/hono` `serve()` handler does
 * NOT pass `c.env` into a function/step body — it only feeds the client's keys.
 * So an env-DEPENDENT durable function (e.g. one that sends email through
 * `getEmailProvider(env)`) has no way to reach the bindings.
 *
 * `AsyncLocalStorage` solves this concurrency-safely. Each Inngest step is a
 * SEPARATE HTTP POST to `/api/inngest`, so wrapping the serve call in
 * `runWithRequestEnv(c.env, () => handler(c))` establishes a fresh env context
 * per request; everything awaited inside (comm handler → function → `step.run`
 * callback) runs within it. Concurrent requests get isolated `.run()` frames —
 * no module-global mutable env (which would bleed env across concurrent
 * requests in one isolate, the `state-is-the-enemy` hazard).
 *
 * @example
 * // serve.ts (per request):
 * return runWithRequestEnv(c.env, () => inngestServeHandler(c));
 * // functions.ts (inside a step):
 * const result = await handleEmailRequested(getRequestEnv(), event.data);
 *
 * @see docs/adr/0003-cloudflare-workflows-inngest-hatchet-routing.md
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type { Env } from '../types/env.js';

/** Thrown when {@link getRequestEnv} runs outside a serve-request context. */
export class InngestEnvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InngestEnvError';
  }
}

/** The single ALS instance carrying the bound `Env` for the current request. */
const envStore = new AsyncLocalStorage<Env>();

/**
 * Run `fn` with `env` bound as the current Inngest request env. Everything
 * awaited inside the callback can read it via {@link getRequestEnv}.
 *
 * @param env - The Worker bindings for THIS serve request (`c.env`).
 * @param fn  - The work to run within the env context (returns its value).
 * @returns Whatever `fn` returns.
 * @example
 * const res = runWithRequestEnv(c.env, () => inngestServeHandler(c));
 */
export function runWithRequestEnv<T>(env: Env, fn: () => T): T {
  return envStore.run(env, fn);
}

/**
 * Read the `Env` bound by the enclosing {@link runWithRequestEnv}.
 *
 * @returns The current request's Worker bindings.
 * @throws {InngestEnvError} When called outside a `runWithRequestEnv` context —
 *   a programming error (a durable function ran without the serve wrapper).
 * @example
 * const env = getRequestEnv();
 * await getEmailProvider(env).sendTransactional({ ... });
 */
export function getRequestEnv(): Env {
  const env = envStore.getStore();
  if (!env) {
    throw new InngestEnvError(
      'getRequestEnv() called outside an Inngest serve-request context — wrap the serve handler in runWithRequestEnv(c.env, ...)',
    );
  }
  return env;
}
