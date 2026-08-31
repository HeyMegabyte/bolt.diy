/**
 * Per-site daily request cap (Stage 4.2c, ADR-0035 §10) — the impure half of the
 * coarse 100k/day ceiling whose pure helpers live in `functions_guardrails.ts`.
 *
 * The design deliberately avoids a Durable Object (its migration would gate every
 * deploy on this worker's fragile DO-migration history) AND a per-request KV write
 * (blows the KV write quota + the 1-write/sec/key limit). Instead:
 *
 *   1. **Count** — every real dispatch fire-and-forgets ONE Analytics-Engine data point
 *      (`recordFunctionsDispatch` → `cf_analytics.recordEvent('fn_dispatch')`). AE is
 *      built for high-volume writes; zero hot-path latency, no KV quota cost.
 *   2. **Aggregate** — a five-minute cron (`enforceFunctionsDailyCaps`) SUMs the day's
 *      dispatches per site via the AE SQL API and flips a per-site KV `fn_overcap:<id>`
 *      flag (TTL → next UTC midnight) for any site at/over the cap.
 *   3. **Enforce** — the hot path reads that ONE cheap, edge-cached flag
 *      (`isSiteOverDailyCap`) and 429s when it is set.
 *
 * Coarse by construction (≤5-min flag lag + AE sampling). That is fine for an abuse
 * ceiling; the precise per-request bound is the 4.2a per-IP limit + 4.2d per-invocation
 * CPU/subrequest caps. Every function here FAILS OPEN (a fault never blocks a legit
 * request and never fails the cron) — an abuse cap must never take a site down.
 */
import type { Env } from '../types/env.js';
import { recordEvent, querySql } from './cf_analytics.js';
import {
  overCapKey,
  secondsUntilUtcMidnight,
  functionsDailyCapCountSql,
  FUNCTIONS_DAILY_CAP,
} from './functions_guardrails.js';

/**
 * Fire-and-forget: record ONE dispatch against a site's daily count in Analytics Engine.
 * Reuses the shared `recordEvent` layout (`blob1='fn_dispatch'`, `blob3=siteId`). Never
 * throws — a metrics write must not affect the dispatch it measures.
 *
 * @param env - worker env (needs the `ANALYTICS` binding; a no-op without it, e.g. dev)
 * @param siteId - the dispatched site
 * @param orgId - the site's org (the AE sampling index)
 * @param path - the request path (diagnostic blob; not used by the cap query)
 * @example recordFunctionsDispatch(env, 'abc', 'org1', '/api/hello')
 */
export function recordFunctionsDispatch(
  env: Env,
  siteId: string,
  orgId: string,
  path: string,
): void {
  try {
    recordEvent(env, { event: 'fn_dispatch', siteId, orgId, routePath: path });
  } catch {
    /* fail-open — never let a metrics write break dispatch */
  }
}

/**
 * Hot-path check: is this site currently flagged over its daily cap? One cheap,
 * edge-cached KV read of {@link overCapKey}. FAILS OPEN (returns false) on any KV
 * fault or a missing binding — an abuse cap must never hard-fail a legit request.
 *
 * @param env - worker env (needs `CACHE_KV`)
 * @param siteId - the site being dispatched
 * @returns true iff the over-cap flag is present for this site
 * @example if (await isSiteOverDailyCap(env, siteId)) return overCapResponse();
 */
export async function isSiteOverDailyCap(env: Env, siteId: string): Promise<boolean> {
  try {
    if (!env.CACHE_KV) return false;
    return (await env.CACHE_KV.get(overCapKey(siteId))) != null;
  } catch {
    return false;
  }
}

/**
 * The 429 body returned on the hot path when a site is over its daily cap. Mirrors the
 * 4.2a rate-limit shape (`RATE_LIMITED`) so clients handle both uniformly.
 *
 * @param now - current instant (drives `retry-after` → next UTC midnight)
 * @returns a 429 `Response` with a JSON error envelope + `retry-after`
 */
export function overCapResponse(now: Date = new Date()): Response {
  return new Response(
    JSON.stringify({
      error: {
        code: 'RATE_LIMITED',
        message: 'This site has reached its daily request limit. Try again tomorrow.',
      },
    }),
    {
      status: 429,
      headers: {
        'content-type': 'application/json',
        'retry-after': String(secondsUntilUtcMidnight(now)),
      },
    },
  );
}

/**
 * Cron entry (runs every 5 minutes): SUM today's dispatches per site in Analytics Engine and
 * set the `fn_overcap:<siteId>` KV flag (TTL → next UTC midnight) for every site at/over
 * the cap. Idempotent — re-running just refreshes the flags; the TTL clears them at day
 * rollover. FAILS SOFT: an AE-query or KV fault logs nothing fatal and returns the count
 * flagged so far (0 on total failure) — the cap simply isn't enforced this cycle.
 *
 * @param env - worker env (needs `CF_ACCOUNT_ID` + `CF_API_TOKEN` for the AE query, `CACHE_KV` for the flag)
 * @param cap - the daily ceiling (defaults to {@link FUNCTIONS_DAILY_CAP})
 * @param now - current instant (drives the flag TTL)
 * @returns the number of sites flagged over cap this run
 * @example const n = await enforceFunctionsDailyCaps(env); // e.g. 0
 */
export async function enforceFunctionsDailyCaps(
  env: Env,
  cap = FUNCTIONS_DAILY_CAP,
  now: Date = new Date(),
): Promise<number> {
  if (!env.CACHE_KV || !env.CF_ACCOUNT_ID || !env.CF_API_TOKEN) return 0;
  let rows: { [k: string]: string | number }[];
  try {
    rows = await querySql(env, functionsDailyCapCountSql(cap));
  } catch {
    return 0; // AE unreachable → skip this cycle (fail-soft)
  }
  const ttl = secondsUntilUtcMidnight(now);
  let flagged = 0;
  for (const row of rows) {
    const siteId = typeof row.site_id === 'string' ? row.site_id : String(row.site_id ?? '');
    if (!siteId || siteId === '-') continue;
    try {
      await env.CACHE_KV.put(overCapKey(siteId), '1', { expirationTtl: ttl });
      flagged++;
    } catch {
      /* fail-soft per site — one bad KV write never blocks the rest */
    }
  }
  return flagged;
}
