/**
 * Functions dispatch decision (Stage 3.1 core, ADR-0035 §30).
 *
 * Pure resolution of what `site_serving` should do with a CHILD-HOST request:
 * hand it to the platform's own handler (reserved paths), dispatch it to the
 * site's bundled `functions/` worker on Workers-for-Platforms, or fall through
 * to normal R2 static / 404 serving. The core decision (`resolveFunctionsDispatch`)
 * is PURE so the ordering is unit-tested in isolation; `maybeDispatchFunctions`
 * (below) is the impure orchestrator the `site_serving` catch-all calls — it
 * resolves the two signals (`entitled` from `getOrgEntitlements(...).customEndpoints`
 * and `hasDeployedScript` from the deploy signal Stage 2.2 records) and dispatches.
 * Reuses the shared reserved-prefix + script-name SSOT so the runtime dispatch
 * guard can never drift from the build-time collision check.
 *
 * Ordering (first match wins):
 *   1. not `/api/*`                      → passthrough (static content)
 *   2. reserved platform prefix          → reserved (platform handler owns it)
 *   3. entitled AND a script is deployed → dispatch to `site-<siteId>`
 *   4. otherwise                         → passthrough (404 not 403 — never
 *      reveal a gated capability, per the feature-flags doctrine)
 */
import type { Env } from '../types/env.js';
import { log } from '../lib/log.js';
import { getOrgEntitlements } from './billing.js';
import { siteHasDeployedFunctions } from './functions_deploy.js';
import { isReservedFunctionRoute } from './functions/router.js';
import { dispatchToUserWorker, siteFunctionsScriptName } from './wfp_dispatch.js';
import { isBodyTooLarge, rateLimitKey, type RateLimiterBinding } from './functions_guardrails.js';

/** Scoped structured logger — its JSON lines feed Workers Observability → the Log Explorer. */
const fnLog = log.child('functions');

/** What `site_serving` should do with a child-host request. */
export type FunctionsDispatchDecision =
  | { action: 'reserved' } // a platform-reserved path — the existing handler owns it
  | { action: 'dispatch'; scriptName: string } // hand to the site's WfP functions worker
  | { action: 'passthrough' }; // not a functions request / not entitled / no script → R2 / 404

/**
 * Decide how to route a child-host request between the platform, the site's
 * `functions/` worker, and normal static serving. Pure — same inputs, same
 * decision; never throws.
 *
 * @param input.pathname - the request path (e.g. `/api/quote`, `/about`)
 * @param input.siteId - the site whose worker would serve a dispatch
 * @param input.entitled - the org has the `customEndpoints` entitlement
 * @param input.hasDeployedScript - a `site-<siteId>` worker is live on WfP
 * @returns a typed dispatch decision
 * @example
 * resolveFunctionsDispatch({ pathname: '/api/quote', siteId: 'abc', entitled: true, hasDeployedScript: true })
 * // → { action: 'dispatch', scriptName: 'site-abc' }
 */
export function resolveFunctionsDispatch(input: {
  pathname: string;
  siteId: string;
  entitled: boolean;
  hasDeployedScript: boolean;
  /** Stage 2.3: route to the `site-<id>-preview` slot instead of the live script. */
  preview?: boolean;
}): FunctionsDispatchDecision {
  // Only /api/* paths are ever candidates for functions dispatch — everything
  // else is static content served from R2.
  if (!input.pathname.startsWith('/api/')) return { action: 'passthrough' };

  // The platform owns its reserved prefixes; a user function at one of these
  // paths is IGNORED (contact-form / events / _ps must reach the platform
  // handler, never the site's worker).
  if (isReservedFunctionRoute(input.pathname)) return { action: 'reserved' };

  // A non-reserved /api/* dispatches only when the org is entitled AND a bundle
  // is actually live; otherwise fall through to R2/404 (404 not 403, so a gated
  // capability is never revealed).
  if (input.entitled && input.hasDeployedScript) {
    return {
      action: 'dispatch',
      scriptName: siteFunctionsScriptName(input.siteId, { preview: input.preview }),
    };
  }
  return { action: 'passthrough' };
}

/**
 * Impure dispatch orchestrator the `site_serving` catch-all calls after
 * resolving the site: for a CHILD-HOST request, resolve the entitlement +
 * deployed-script signals and, if {@link resolveFunctionsDispatch} says so, hand
 * the request to the site's WfP `functions/` worker.
 *
 * Hot-path discipline: the cheap checks run first (a non-`/api/*` or reserved
 * path returns immediately with ZERO D1 reads), and the deployed-script gate is
 * read BEFORE the entitlement — a site with no functions worker (the common
 * case) costs exactly one D1 read, never the entitlement lookup or a dispatch.
 *
 * Observability (ADR §13): a successful dispatch emits a `functions.invoke` Trace
 * event and a failure a `functions.dispatch_error` event (tenant-tagged with
 * orgId/siteId), so owners see invocations + errors in the Log Explorer / Traces.
 *
 * Fail-soft: any error — a D1 read, the entitlement lookup, or the dispatch
 * itself — is LOGGED (never silently swallowed — that would hide an outage) then
 * returns `null` so the caller falls through to normal R2 / 404 serving. A
 * functions failure must NEVER take down static site serving.
 *
 * @returns the worker's `Response` when dispatched, else `null` (passthrough)
 * @remarks Impure — reads D1 + issues a subrequest to the dispatch namespace.
 * @example
 * const fn = await maybeDispatchFunctions(env, { siteId, orgId }, req, path);
 * if (fn) return fn; // else fall through to serveSiteFromR2
 */
export async function maybeDispatchFunctions(
  env: Env,
  site: { siteId: string; orgId: string },
  request: Request,
  pathname: string,
): Promise<Response | null> {
  // Cheap pre-gate — only non-reserved /api/* paths are dispatch candidates;
  // everything else (static assets, reserved platform routes) skips all D1 reads.
  if (!pathname.startsWith('/api/') || isReservedFunctionRoute(pathname)) return null;
  const startedAt = Date.now();
  // Stage 2.3 preview slot: `?_ps_preview=1` routes to `site-<id>-preview` (the owner
  // testing an as-yet-unpromoted bundle) and SKIPS the live deploy-signal gate — the
  // preview script has its own slot; a missing `-preview` just fails soft to passthrough.
  const preview = new URL(request.url).searchParams.get('_ps_preview') === '1';
  try {
    // Deployed-script gate first (LIVE only): most sites have none → one D1 read →
    // passthrough, never paying for the entitlement lookup or a doomed dispatch.
    if (!preview && !(await siteHasDeployedFunctions(env.DB, site.siteId))) return null;
    const entitled = (await getOrgEntitlements(env.DB, site.orgId)).customEndpoints;
    const decision = resolveFunctionsDispatch({
      pathname,
      siteId: site.siteId,
      entitled,
      hasDeployedScript: true,
      preview,
    });
    if (decision.action !== 'dispatch') return null;

    // Stage 4.2 — default abuse guardrails, applied BEFORE the user worker runs.
    // (1) Body cap: reject an over-large body up front (413) so a single request
    // can't exhaust memory. (2) Per-IP rate-limit (429) via the native ratelimit
    // binding. Both emit a tenant-tagged `functions.rejected` Trace event (§13) and
    // fail OPEN when their mechanism is absent (dev) — never block a legit request.
    if (isBodyTooLarge(request)) {
      fnLog.info('functions.rejected', {
        orgId: site.orgId,
        siteId: site.siteId,
        method: request.method,
        path: pathname,
        status: 413,
        reason: 'body_too_large',
        durationMs: Date.now() - startedAt,
        requestId: request.headers.get('cf-ray') ?? undefined,
      });
      return new Response(
        JSON.stringify({
          error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body exceeds the 25 MB limit.' },
        }),
        { status: 413, headers: { 'content-type': 'application/json' } },
      );
    }
    const limiter = (env as unknown as { FUNCTIONS_RATELIMIT?: RateLimiterBinding })
      .FUNCTIONS_RATELIMIT;
    if (limiter) {
      const { success } = await limiter.limit({
        key: rateLimitKey(site.siteId, request.headers.get('cf-connecting-ip')),
      });
      if (!success) {
        fnLog.info('functions.rejected', {
          orgId: site.orgId,
          siteId: site.siteId,
          method: request.method,
          path: pathname,
          status: 429,
          reason: 'rate_limited',
          durationMs: Date.now() - startedAt,
          requestId: request.headers.get('cf-ray') ?? undefined,
        });
        return new Response(
          JSON.stringify({
            error: {
              code: 'RATE_LIMITED',
              message: 'Too many requests — slow down and try again shortly.',
            },
          }),
          {
            status: 429,
            headers: { 'content-type': 'application/json', 'retry-after': '10' },
          },
        );
      }
    }

    const res = await dispatchToUserWorker(env, decision.scriptName, request);
    // 5.2 (ADR §13): emit a tenant-tagged invocation event via the canonical
    // structured logger → Workers Observability → the Log Explorer (`/admin/logs`).
    // Field names match `logs_explorer.mapEvent` (msg/method/path/status/durationMs/
    // requestId) so the invocation renders as a real log row; orgId/siteId land in
    // the row `meta` for per-site filtering. `requestId` (not `cfRay`) is the field
    // mapEvent reads.
    // (scriptName is omitted — it is `site-<siteId>`, fully derivable from siteId,
    // and not in the logger's SAFE_FIELD_ALLOWLIST; siteId is the queryable key.)
    fnLog.info('functions.invoke', {
      orgId: site.orgId,
      siteId: site.siteId,
      method: request.method,
      path: pathname,
      status: res.status,
      durationMs: Date.now() - startedAt,
      requestId: request.headers.get('cf-ray') ?? undefined,
    });
    return res;
  } catch (err) {
    // 5.2 + fail-soft: log the failure as an error event (never silently swallow —
    // that hides outages from monitoring) THEN degrade to static serving.
    fnLog.error('functions.dispatch_error', {
      orgId: site.orgId,
      siteId: site.siteId,
      path: pathname,
      error: (err instanceof Error ? err.message : String(err)).slice(0, 200),
      durationMs: Date.now() - startedAt,
      requestId: request.headers.get('cf-ray') ?? undefined,
    });
    return null;
  }
}
