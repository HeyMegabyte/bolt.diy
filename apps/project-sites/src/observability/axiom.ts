/**
 * Fire-and-forget Axiom structured-log ingest.
 *
 * Sends a batch of events to the Axiom `/ingest` endpoint using the Worker's
 * `ExecutionContext.waitUntil` so the ingest never blocks a response.
 * Silently no-ops when `env.AXIOM_ENABLED !== 'true'` or when
 * `env.AXIOM_TOKEN` is absent.
 *
 * @module observability/axiom
 */

import type { Env } from '../types/env.js';

/**
 * Ship a batch of events to Axiom via fire-and-forget ingest.
 *
 * @param env      - Worker env bindings; reads `AXIOM_TOKEN` and `AXIOM_ENABLED`.
 * @param ctx      - Worker execution context; ingest is deferred via `waitUntil`.
 * @param dataset  - Axiom dataset name (e.g. `'projectsites'`).
 * @param events   - Array of structured event objects to ship.
 * @returns `void` — always synchronous from the caller's perspective.
 *
 * @example
 * ```ts
 * sendToAxiom(env, ctx, 'projectsites', [{
 *   level: 'info', ts: Date.now(), msg: 'site created', site_id: 'abc'
 * }]);
 * ```
 */
export function sendToAxiom(
  env: Env,
  ctx: ExecutionContext | undefined,
  dataset: string,
  events: readonly Record<string, unknown>[],
): void {
  if (env.AXIOM_ENABLED !== 'true' || !env.AXIOM_TOKEN) return;

  const token = env.AXIOM_TOKEN;
  const promise = fetch(`https://api.axiom.co/v1/datasets/${dataset}/ingest`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(events),
  }).catch((err: unknown) => {
    console.warn(
      JSON.stringify({
        level: 'warn',
        service: 'axiom',
        msg: 'Axiom ingest failed',
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  });

  // Defer via waitUntil when an ExecutionContext is available; otherwise the
  // promise still runs fire-and-forget (e.g. unit tests, queue/cron paths).
  if (ctx && typeof ctx.waitUntil === 'function') {
    ctx.waitUntil(promise);
  } else {
    void promise;
  }
}
