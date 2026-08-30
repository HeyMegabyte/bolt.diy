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
import { resolveEnvVarsForFunctions } from './ai_env_vars.js';
import { signFunctionToken } from './functions/internal.js';
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
  opts: { siteId: string; orgId: string; build: FunctionsBuildResult; preview?: boolean },
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

  const { build, preview } = opts;

  // Bad build → keep the last-good script live; do NOT touch WfP.
  if (!build.ok) return { status: 'build_failed', error: build.error };

  // Empty functions/ → remove any stale script so a deleted folder stops serving,
  // and CLEAR the deploy signal so Stage 3.1 dispatch stops routing to it. In
  // preview mode this only clears the `-preview` slot (never the live signal).
  if (!('script' in build)) {
    await deleteSiteFunctionsWorker(env, opts.siteId, { preview });
    if (!preview) await recordFunctionsDeploy(env.DB, opts.siteId, false).catch(() => {});
    return { status: 'removed' };
  }

  // Stage 4.1 — resolve the site+org env-vars into the `env.SECRETS` blob the
  // runtime shim reads. Fail-soft: a resolve/decrypt failure deploys WITHOUT
  // secrets (empty `env.SECRETS`) rather than blocking the publish. Both the live
  // AND preview slots carry the secrets so the owner tests against real values.
  let secretsJson: string | undefined;
  try {
    const secrets = await resolveEnvVarsForFunctions(env, opts.orgId, opts.siteId);
    if (Object.keys(secrets).length > 0) secretsJson = JSON.stringify(secrets);
  } catch {
    /* fail-soft — deploy without secrets rather than block the publish */
  }

  // Stage 4.1(b) — the shared functions KV namespace id (a `wrangler.toml` var,
  // read via a narrow cast so this never depends on the Env type — `env.ts` is
  // owned by a concurrent session this pass). Absent → no `__PS_KV` binding → the
  // shim yields no `env.KV` (fail-soft).
  const kvNamespaceId = (env as unknown as { FUNCTIONS_KV_ID?: string }).FUNCTIONS_KV_ID;
  // Stage 4.1(c) — the platform R2 bucket name (a `wrangler.toml` var). The shim
  // prefixes `sites-data/<siteId>/` so the raw bucket is never reachable. Same
  // narrow-cast pattern (avoids the concurrent-dirty `env.ts`). Absent → no env.R2.
  const r2BucketName = (env as unknown as { FUNCTIONS_R2_BUCKET?: string }).FUNCTIONS_R2_BUCKET;
  // Stage 4.1(d) — env.AI: sign a per-site token (HMAC of siteId) + the platform
  // internal URL the shim POSTs to (/api/_ps/ai/run). Both from cast-read config
  // (env.ts concurrent-dirty). Absent secret/url → no token → no env.AI (fail-soft).
  const fnUrl = (env as unknown as { FUNCTIONS_INTERNAL_URL?: string }).FUNCTIONS_INTERNAL_URL;
  const fnSecret = (env as unknown as { FUNCTIONS_INTERNAL_SECRET?: string })
    .FUNCTIONS_INTERNAL_SECRET;
  let fnToken: string | undefined;
  if (fnSecret && fnUrl) {
    try {
      fnToken = await signFunctionToken(fnSecret, opts.siteId);
    } catch {
      /* fail-soft — deploy without env.AI rather than block the publish */
    }
  }

  // Good build → upload. An upload failure leaves the previous script in place
  // (the PUT never overwrote), so last-good is preserved either way. Preview
  // uploads to `site-<id>-preview` and NEVER touches the live deploy signal or the
  // persisted last-good bundle (Stage 2.3 — the owner tests it before promoting).
  const res = await uploadSiteFunctionsWorker(env, opts.siteId, build.script, {
    preview,
    secretsJson,
    kvNamespaceId,
    r2BucketName,
    fnToken,
    fnUrl,
  });
  if (res.ok) {
    if (!preview) {
      // Record the deploy so Stage 3.1 dispatch knows a script is live. Fail-soft:
      // a signal-write failure must not fail the publish — dispatch just won't
      // route to the new script until the next successful publish.
      await recordFunctionsDeploy(env.DB, opts.siteId, true).catch(() => {});
      // Persist the last-good bundle to R2 so the Stage 2.3 preview slot
      // (`/api/test-publish`) can redeploy it WITHOUT a fresh container build.
      // Fail-soft: a persist failure only means test-publish lacks a bundle.
      await persistFunctionsBundle(env, opts.siteId, build.script).catch(() => {});
    }
    return { status: 'deployed', scriptName: res.scriptName };
  }
  return { status: 'upload_failed', error: res.error, httpStatus: res.status };
}

/** R2 key for a site's last-good functions bundle (the preview slot's source). */
export function functionsBundleKey(siteId: string): string {
  return `functions-bundles/${siteId}.js`;
}

/**
 * Persist a site's last-good functions bundle to R2 so the Stage 2.3 preview slot
 * can redeploy it without a container rebuild. Impure — writes R2.
 * @example await persistFunctionsBundle(env, siteId, script)
 */
export async function persistFunctionsBundle(
  env: Env,
  siteId: string,
  script: string,
): Promise<void> {
  await env.SITES_BUCKET.put(functionsBundleKey(siteId), script, {
    httpMetadata: { contentType: 'application/javascript' },
  });
}

/**
 * Read a site's last-good functions bundle from R2 (null if it never built one).
 * The Stage 2.3 `/api/test-publish` handler reuses it for the preview deploy.
 * @returns the bundle text, or null when absent
 * @example const script = await readFunctionsBundle(env, siteId)
 */
export async function readFunctionsBundle(env: Env, siteId: string): Promise<string | null> {
  const obj = await env.SITES_BUCKET.get(functionsBundleKey(siteId));
  return obj ? await obj.text() : null;
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
