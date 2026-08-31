/**
 * Bolt-editor publish → functions deploy (Stage 2.2d, ADR-0035).
 *
 * The bolt.diy editor publishes a site as a flat `files[]` array uploaded DIRECTLY
 * to R2 — no container, no esbuild in the Worker. So a `functions/` folder edited
 * in bolt lands in R2 as raw source but is never bundled/deployed to WfP. This
 * module closes that gap: it extracts the `functions/` subtree from the publish
 * payload and bundles it via the CONTAINER (the only place esbuild + the platform
 * codegen run).
 *
 * ⚠️ Why the container, not a client-provided bundle: the tenant-scoping shims
 * (`env.KV`/`env.R2`) are enforced by the PLATFORM-generated worker entry, which
 * calls `buildFunctionsEnv` to strip the raw `__PS_*` bindings before user code
 * runs. A client-supplied bundle could ship its own entry that reads the raw
 * `__PS_KV`/`__PS_R2` bindings directly → full-namespace, cross-tenant access. So
 * the platform MUST own the bundle: we send only the function SOURCES to the
 * container, which wraps them with the trusted codegen (same path as the AI build).
 */
import type { Env } from '../types/env.js';
import type { FunctionsBuildResult } from './functions_deploy.js';

/** A single file in a bolt publish payload. */
export interface BoltFile {
  path: string;
  content: string;
}

/**
 * Extract the `functions/` subtree from a bolt publish `files[]` payload. Keeps
 * the `functions/` path prefix (the container's `cli.ts` bundles `<dir>/functions/`),
 * tolerates a leading `./` or `/`, and drops path-traversal (`..`) entries — the
 * container re-sanitizes too (defense in depth). Pure.
 *
 * @example extractFunctionsFiles([{path:'functions/api/hello.ts',content:'…'},{path:'index.html',content:'…'}])
 *   // → [{path:'functions/api/hello.ts',content:'…'}]
 */
export function extractFunctionsFiles(files: BoltFile[]): BoltFile[] {
  return (files ?? []).filter((f) => {
    if (!f || typeof f.path !== 'string' || typeof f.content !== 'string') return false;
    const norm = f.path.replace(/^\.?\//, '');
    return /^functions\//.test(norm) && !norm.split('/').includes('..');
  });
}

/**
 * Bundle a bolt-edited `functions/` subtree into a single WfP worker via the
 * container's `POST /bundle-functions` endpoint (reuses the Stage 2.2a
 * functions-build CLI + the trusted platform codegen). Returns the exact
 * {@link FunctionsBuildResult} the container's `cli.ts` emits so the caller can
 * hand it straight to `deploySiteFunctions`.
 *
 * A fresh container instance is addressed per call (`bundlefn-<siteId>-<version>`)
 * so it cold-starts on the LATEST image — never a stale warm build instance.
 *
 * NEVER throws — any transport/parse/timeout fault → `{ ok:false, error }`, which
 * makes `deploySiteFunctions` keep the last-good worker; the static publish is
 * unaffected. Empty subtree → `{ ok:true, empty:true }` (removes any stale worker).
 *
 * @remarks Impure — fetches the SITE_BUILDER Durable Object (container).
 * @example await bundleFunctionsViaContainer(env, siteId, version, fnFiles)
 */
export async function bundleFunctionsViaContainer(
  env: Env,
  siteId: string,
  version: string,
  functionsFiles: BoltFile[],
): Promise<FunctionsBuildResult> {
  if (functionsFiles.length === 0) return { ok: true, empty: true };
  const builder = (env as unknown as { SITE_BUILDER?: DurableObjectNamespace }).SITE_BUILDER;
  if (!builder) return { ok: false, error: 'container unavailable (no SITE_BUILDER binding)' };
  try {
    const id = builder.idFromName(`bundlefn-${siteId}-${version}`);
    const stub = builder.get(id);
    const res = await stub.fetch('http://container/bundle-functions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: functionsFiles }),
    });
    if (!res.ok) {
      return { ok: false, error: `container ${res.status}: ${(await res.text()).slice(0, 240)}` };
    }
    const build = (await res.json()) as FunctionsBuildResult;
    // Validate the shape defensively — a malformed container response must not
    // masquerade as a good bundle (which would upload garbage to WfP).
    if (build && typeof build === 'object' && 'ok' in build) return build;
    return { ok: false, error: 'container returned a malformed FunctionsBuildResult' };
  } catch (e) {
    return {
      ok: false,
      error: `container bundle fetch failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}
