/**
 * Container-side "bundle the site's functions/ on Publish" bridge (Stage 2.2a,
 * ADR-0035 §5).
 *
 * Runs in the build container AFTER the site build: given the built site root, it
 * locates the `functions/` folder, bundles it via the Stage 1.1 esbuild bundler,
 * and returns the exact {@link FunctionsBuildResult} shape the WORKER's
 * `deploySiteFunctions` consumes — so the worker publish path only forwards the
 * result to Workers-for-Platforms and NEVER runs esbuild (impossible at the edge).
 *
 * NODE-ONLY (esbuild + fs) — lives under scripts/ so it's excluded from the Worker
 * TS project + bundle. The `FunctionsBuildResult` type is imported type-only from
 * the worker service (erased at compile), keeping ONE definition with zero runtime
 * coupling to the Worker.
 *
 * Never throws — a functions failure must not fail the static publish:
 *   no functions/ folder / no routable files → { ok: true, empty: true }
 *   clean bundle                             → { ok: true, script }
 *   reserved-path / route collision / npm / esbuild failure → { ok: false, error }
 */
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { FunctionsBuildResult } from '../../src/services/functions_deploy.js';
import { bundleFunctions, listFunctionFiles } from './bundle.js';

/** Normalise any thrown value to a single-line message (capped for logs/UI). */
function toError(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 500);
}

/**
 * Bundle a built site's `functions/` folder into a WfP-ready deploy result.
 *
 * @param siteDir - absolute path to the built site root (the dir that may contain `functions/`)
 * @param opts.runtimePath - override runtime.ts path (defaults to the repo's)
 * @param opts.install - run `npm install` when `functions/package.json` exists (default true; container installs user deps)
 * @returns the {@link FunctionsBuildResult} the worker's `deploySiteFunctions` consumes
 * @remarks Impure — reads the filesystem + shells esbuild/npm. Never throws.
 * @example
 * const build = await buildSiteFunctions('/build/site');
 * // → { ok: true, script } | { ok: true, empty: true } | { ok: false, error }
 * await deploySiteFunctions(env, { siteId, orgId, build }); // worker-side (Stage 2.2 wiring)
 */
export async function buildSiteFunctions(
  siteDir: string,
  opts: { runtimePath?: string; install?: boolean } = {},
): Promise<FunctionsBuildResult> {
  const functionsDir = resolve(join(siteDir, 'functions'));

  // No functions/ folder → nothing to deploy (the worker removes any stale script).
  if (!existsSync(functionsDir)) return { ok: true, empty: true };

  // A functions/ folder with no routable handler files (only _helpers / .d.ts /
  // package.json) is "empty" too — never upload an empty router.
  let fileCount: number;
  try {
    fileCount = listFunctionFiles(functionsDir).length;
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
  if (fileCount === 0) return { ok: true, empty: true };

  try {
    const { script } = await bundleFunctions({
      functionsDir,
      runtimePath: opts.runtimePath,
      install: opts.install ?? true,
    });
    // A non-empty file set that produced no script is a build anomaly — treat as
    // empty rather than upload a blank worker.
    if (!script) return { ok: true, empty: true };
    return { ok: true, script };
  } catch (err) {
    // FunctionsBuildError (reserved-path / route collision) + npm / esbuild
    // failures all degrade to a surfaced build error — the worker keeps the
    // last-good script live and shows the owner the failure.
    return { ok: false, error: toError(err) };
  }
}
