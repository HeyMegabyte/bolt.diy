/**
 * Functions publish orchestration (Stage 2.2c, ADR-0035 §5).
 *
 * Called on Publish AFTER the container bundles the site's `functions/` folder
 * (esbuild → one ESM Worker via `scripts/functions-build`). It gates the deploy
 * on WfP config + the `customEndpoints` entitlement, then routes the build
 * result to the WfP upload/delete helpers:
 *
 *   bad build  → keep the last-good functions live (never touch WfP), surface it
 *   empty      → remove any stale `site-<siteId>` script
 *   good build → upload `site-<siteId>`
 *
 * NEVER throws — a functions failure must not take down a content publish
 * ("publish the static site, keep last-good functions live" per the ADR).
 */
import type { Env } from '../types/env.js';
import { getOrgEntitlements } from './billing.js';
import {
  isWfpConfigured,
  siteFunctionsScriptName,
  uploadSiteFunctionsWorker,
  deleteSiteFunctionsWorker,
} from './wfp_dispatch.js';

/** The container bundle outcome for a site's `functions/` folder. */
export type FunctionsBuildResult =
  | { ok: true; script: string } // one esbuild ESM Worker bundle
  | { ok: true; empty: true } // no `functions/` folder, or it declares no routes
  | { ok: false; error: string }; // reserved-path collision / npm / esbuild failure

/** Outcome of the publish-time functions deploy (all non-fatal to the static publish). */
export type DeploySiteFunctionsResult =
  | { status: 'deployed'; scriptName: string }
  | { status: 'removed' }
  | { status: 'skipped_not_entitled' }
  | { status: 'wfp_unconfigured' }
  | { status: 'build_failed'; error: string }
  | { status: 'upload_failed'; error: string; httpStatus?: number };

/**
 * Deploy (or remove) a site's bundled `functions/` worker on Publish.
 *
 * @param opts.build - the container's bundle result (see {@link FunctionsBuildResult})
 * @returns a typed, non-throwing outcome
 * @example await deploySiteFunctions(env, { siteId, orgId, build: { ok: true, script } })
 */
export async function deploySiteFunctions(
  env: Env,
  opts: { siteId: string; orgId: string; build: FunctionsBuildResult },
): Promise<DeploySiteFunctionsResult> {
  if (!isWfpConfigured(env)) return { status: 'wfp_unconfigured' };

  // Entitlement gate. A lookup failure degrades to "skip" (never block publish).
  let entitled = false;
  try {
    entitled = (await getOrgEntitlements(env.DB, opts.orgId)).customEndpoints;
  } catch {
    return { status: 'skipped_not_entitled' };
  }
  if (!entitled) return { status: 'skipped_not_entitled' };

  const { build } = opts;

  // Bad build → keep the last-good script live; do NOT touch WfP.
  if (!build.ok) return { status: 'build_failed', error: build.error };

  // Empty functions/ → remove any stale script so a deleted folder stops serving.
  if (!('script' in build)) {
    await deleteSiteFunctionsWorker(env, opts.siteId);
    return { status: 'removed' };
  }

  // Good build → upload. An upload failure leaves the previous script in place
  // (the PUT never overwrote), so last-good is preserved either way.
  const res = await uploadSiteFunctionsWorker(env, opts.siteId, build.script);
  if (res.ok) return { status: 'deployed', scriptName: res.scriptName };
  return { status: 'upload_failed', error: res.error, httpStatus: res.status };
}

/** The WfP script name a deploy targets — re-exported so callers/logs share the SSOT. */
export { siteFunctionsScriptName };
