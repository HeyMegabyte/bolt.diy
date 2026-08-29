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
import { dbUpdate, dbQueryOne } from './db.js';
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

  // Empty functions/ → remove any stale script so a deleted folder stops serving,
  // and CLEAR the deploy signal so Stage 3.1 dispatch stops routing to it.
  if (!('script' in build)) {
    await deleteSiteFunctionsWorker(env, opts.siteId);
    await recordFunctionsDeploy(env.DB, opts.siteId, false).catch(() => {});
    return { status: 'removed' };
  }

  // Good build → upload. An upload failure leaves the previous script in place
  // (the PUT never overwrote), so last-good is preserved either way.
  const res = await uploadSiteFunctionsWorker(env, opts.siteId, build.script);
  if (res.ok) {
    // Record the deploy so Stage 3.1 dispatch knows a script is live. Fail-soft:
    // a signal-write failure must not fail the publish — dispatch just won't
    // route to the new script until the next successful publish.
    await recordFunctionsDeploy(env.DB, opts.siteId, true).catch(() => {});
    return { status: 'deployed', scriptName: res.scriptName };
  }
  return { status: 'upload_failed', error: res.error, httpStatus: res.status };
}

/**
 * Persist whether a site currently has a live `functions/` worker on WfP.
 * Writes `sites.functions_deployed_at` — an ISO timestamp on deploy, NULL on
 * remove — so the Stage 3.1 dispatch guard can decide (via
 * {@link siteHasDeployedFunctions}) whether to route `/api/*` to the site's
 * worker WITHOUT probing WfP on the hot path. Best-effort: callers wrap it so a
 * D1 failure never fails the publish (fail-soft).
 *
 * @remarks Impure — writes D1.
 * @example await recordFunctionsDeploy(env.DB, siteId, true) // marks a live deploy
 */
export async function recordFunctionsDeploy(
  db: D1Database,
  siteId: string,
  deployed: boolean,
): Promise<void> {
  await dbUpdate(
    db,
    'sites',
    { functions_deployed_at: deployed ? new Date().toISOString() : null },
    'id = ?',
    [siteId],
  );
}

/**
 * Whether a site has a live `functions/` worker deployed (the Stage 3.1 dispatch
 * precondition). Reads the `functions_deployed_at` signal written by
 * {@link recordFunctionsDeploy}; soft-deleted sites never qualify.
 *
 * @returns true iff `sites.functions_deployed_at` is a non-null value
 * @example if (await siteHasDeployedFunctions(env.DB, siteId)) { ...dispatch... }
 */
export async function siteHasDeployedFunctions(db: D1Database, siteId: string): Promise<boolean> {
  const row = await dbQueryOne<{ functions_deployed_at: string | null }>(
    db,
    'SELECT functions_deployed_at FROM sites WHERE id = ? AND deleted_at IS NULL',
    [siteId],
  );
  return !!row?.functions_deployed_at;
}

/** The WfP script name a deploy targets — re-exported so callers/logs share the SSOT. */
export { siteFunctionsScriptName };
