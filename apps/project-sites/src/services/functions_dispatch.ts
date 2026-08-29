/**
 * Functions dispatch decision (Stage 3.1 core, ADR-0035 §30).
 *
 * Pure resolution of what `site_serving` should do with a CHILD-HOST request:
 * hand it to the platform's own handler (reserved paths), dispatch it to the
 * site's bundled `functions/` worker on Workers-for-Platforms, or fall through
 * to normal R2 static / 404 serving. Kept pure (no env/DB) so the ordering is
 * unit-tested in isolation; the caller resolves the two signals —
 * `entitled` from `getOrgEntitlements(...).customEndpoints` and
 * `hasDeployedScript` from the deploy signal the publish path (Stage 2.2)
 * records. Reuses the shared reserved-prefix + script-name SSOT so the runtime
 * dispatch guard can never drift from the build-time collision check.
 *
 * Ordering (first match wins):
 *   1. not `/api/*`                      → passthrough (static content)
 *   2. reserved platform prefix          → reserved (platform handler owns it)
 *   3. entitled AND a script is deployed → dispatch to `site-<siteId>`
 *   4. otherwise                         → passthrough (404 not 403 — never
 *      reveal a gated capability, per the feature-flags doctrine)
 */
import { isReservedFunctionRoute } from './functions/router.js';
import { siteFunctionsScriptName } from './wfp_dispatch.js';

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
    return { action: 'dispatch', scriptName: siteFunctionsScriptName(input.siteId) };
  }
  return { action: 'passthrough' };
}
