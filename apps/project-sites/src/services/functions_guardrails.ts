/**
 * Functions dispatch guardrails (Stage 4.2, ADR-0035 §10/§109/§110).
 *
 * Default abuse protection applied BY THE PLATFORM at the dispatch chokepoint
 * (`maybeDispatchFunctions`), BEFORE a request ever reaches the site's user
 * worker — so a site owner gets these for free, without writing any code:
 *
 *  · **Body cap (~25 MB → 413)** — reject an over-large request body up front
 *    (endpoints stream real uploads to `env.R2`, but the raw body is capped so a
 *    single request can't exhaust memory). Content-Length based (a chunked body
 *    with no length is allowed through — rare from browsers; the user worker's own
 *    limits still apply).
 *  · **Default per-IP rate-limit (→ 429)** — a Cloudflare native `ratelimit`
 *    binding keyed `<siteId>:<ip>` (exact, edge-native, zero storage cost). Tunable
 *    per plan; the binding lives in `wrangler.toml` (`FUNCTIONS_RATELIMIT`).
 *  · **Per-site daily cap (100k/day → 429, Stage 4.2c)** — an Analytics-Engine count
 *    (one fire-and-forget `recordEvent('fn_dispatch')` per invocation — no KV write on
 *    the hot path, so no write-quota/1-write-per-sec problem) + a five-minute cron
 *    (`enforceFunctionsDailyCaps`) that SUMs the day's dispatches per site and flips a
 *    per-site KV `fn_overcap:<siteId>` flag (TTL → next UTC midnight, so it self-clears
 *    at day rollover). The hot path reads that ONE cheap flag (`isSiteOverDailyCap`) →
 *    429 when set. No Durable Object, no migration. Coarse by design (a ≤5-min lag +
 *    AE sampling) — fine for an abuse ceiling; the exact per-request bound is the 4.2a
 *    per-IP limit + the 4.2d per-invocation CPU/subrequest caps.
 *
 * Pure helpers here; the impure wiring (the rate-limit binding call + the reject
 * responses + the observability event + the AE count/query + the KV flag) lives in
 * `functions_dispatch.ts` + `functions_daily_cap.ts`.
 */

/** Max raw request body a user endpoint accepts before a 413 (~25 MB, tunable per plan). */
export const FUNCTIONS_BODY_CAP_BYTES = 25 * 1024 * 1024;

/**
 * Per-invocation WfP custom limits applied at DISPATCH (ADR-0035 §10, Stage 4.2d).
 * Cloudflare enforces these on the user worker per request (`USER_DISPATCH.get(name,
 * args, { limits })`): exceeding either throws inside the user worker. `cpuMs` is
 * ACTIVE CPU time (not wall-clock — I/O waits don't count), `subRequests` counts every
 * fetch + binding call (env.AI/DATA/KV/R2 each count). Tunable per plan later.
 */
export const FUNCTIONS_DISPATCH_LIMITS = { cpuMs: 50, subRequests: 50 } as const;

/**
 * Whether a request's declared body exceeds the cap (Content-Length based).
 *
 * A missing/malformed Content-Length returns `false` (allow) — a chunked upload
 * has no declared length; the platform errs open here and relies on the user
 * worker's own handling + the runtime's hard limits. Pure.
 *
 * @param request - the inbound child-host request
 * @param cap - byte ceiling (defaults to {@link FUNCTIONS_BODY_CAP_BYTES})
 * @returns true iff a numeric Content-Length is present AND over the cap
 * @example isBodyTooLarge(new Request(url, { headers: { 'content-length': '99000000' } })) // true
 */
export function isBodyTooLarge(request: Request, cap = FUNCTIONS_BODY_CAP_BYTES): boolean {
  const raw = request.headers.get('content-length');
  if (!raw) return false;
  const len = Number(raw);
  return Number.isFinite(len) && len > cap;
}

/**
 * Per-site daily request ceiling (Stage 4.2c, ADR-0035 §10). A COARSE abuse cap
 * enforced via an AE count + a cron-flipped KV flag (see the module header) — NOT a
 * precise real-time counter. Tunable per plan.
 */
export const FUNCTIONS_DAILY_CAP = 100_000;

/** The Analytics-Engine `blob1` event tag counted for the daily cap (see `cf_analytics.recordEvent`). */
export const FUNCTIONS_DISPATCH_EVENT = 'fn_dispatch' as const;

/**
 * KV key holding the "this site is over its daily cap today" flag. Present (any value)
 * = over cap → 429 on the hot path; absent = under cap. Written by the five-minute cron with
 * a TTL to the next UTC midnight so it self-clears at day rollover.
 *
 * @example overCapKey('abc') // 'fn_overcap:abc'
 */
export function overCapKey(siteId: string): string {
  return `fn_overcap:${siteId}`;
}

/**
 * Seconds from `now` until the next UTC midnight — the TTL for the over-cap flag so it
 * expires exactly when the daily count resets. Floored at 60 (KV rejects a sub-60 TTL).
 *
 * @param now - the current instant
 * @returns whole seconds until 00:00:00 UTC tomorrow (≥ 60)
 * @example secondsUntilUtcMidnight(new Date('2026-01-01T23:59:00Z')) // 60
 */
export function secondsUntilUtcMidnight(now: Date): number {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0);
  return Math.max(60, Math.ceil((next - now.getTime()) / 1000));
}

/**
 * Build the Analytics-Engine SQL that returns each site whose dispatch count SINCE UTC
 * MIDNIGHT is at/over `cap`. `SUM(_sample_interval)` estimates the true count (AE samples
 * under load); `blob3` is the site_id in the `recordEvent` layout; `blob1` isolates our
 * `fn_dispatch` rows from every other event in the shared dataset. Pure (string builder).
 *
 * @param cap - the daily ceiling (defaults to {@link FUNCTIONS_DAILY_CAP})
 * @param dataset - the AE dataset name (defaults to the shared admin dataset)
 * @returns a SQL string for `cf_analytics.querySql`
 */
export function functionsDailyCapCountSql(
  cap = FUNCTIONS_DAILY_CAP,
  dataset = 'projectsites_admin_v1',
): string {
  const safeCap = Math.max(1, Math.floor(cap));
  return (
    `SELECT blob3 AS site_id, SUM(_sample_interval) AS n FROM ${dataset} ` +
    `WHERE blob1 = '${FUNCTIONS_DISPATCH_EVENT}' AND blob3 != '-' ` +
    `AND timestamp >= toStartOfDay(NOW()) ` +
    `GROUP BY site_id HAVING n >= ${safeCap} LIMIT 1000`
  );
}

/** The Cloudflare native `ratelimit` binding shape (mirrors `OAUTH_RATELIMIT`). */
export interface RateLimiterBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

/**
 * The per-IP rate-limit key for a site's functions dispatch: `<siteId>:<ip>` so a
 * burst from one IP against one site is limited without touching other sites/IPs.
 * A missing client IP collapses to a shared `unknown` bucket (fail-closed-ish).
 *
 * @example rateLimitKey('abc', '203.0.113.7') // 'abc:203.0.113.7'
 */
export function rateLimitKey(siteId: string, ip: string | null): string {
  return `${siteId}:${ip || 'unknown'}`;
}
