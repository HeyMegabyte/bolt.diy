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
 *
 * Pure helpers here; the impure wiring (the rate-limit binding call + the reject
 * responses + the observability event) lives in `functions_dispatch.ts`.
 *
 * NOT here (tracked 4.2 remainder): the per-site 100k/day cap (needs a Durable
 * Object / Analytics Engine — a per-request KV write would blow the KV write quota),
 * the opt-in `ctx.verifyOwnerSession()` + Turnstile-verify helpers, and the
 * per-plan CPU/subrequest caps (the Workers runtime already enforces baseline
 * CPU + subrequest limits by construction).
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
