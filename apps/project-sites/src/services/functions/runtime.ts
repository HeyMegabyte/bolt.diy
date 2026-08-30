/**
 * Runtime fetch handler for a bundled `functions/` Worker.
 *
 * The codegen (`codegen.ts`) emits a Worker entry that imports each user
 * handler module, builds a manifest of `{ pattern, module }`, and default-
 * exports `createFunctionsFetchHandler(manifest)`. esbuild then bundles this
 * runtime + `router.ts` into that single per-site Worker script.
 *
 * Pure + zero-dependency (only Web/Workers globals) so it bundles cleanly.
 */
import {
  compileRoutes,
  matchCompiledRoutes,
  selectHandler,
  allowedMethods,
  type FunctionModule,
  type FunctionContext,
} from './router.js';

export interface FunctionManifestEntry {
  pattern: string;
  module: FunctionModule;
}

export interface FunctionsFetchHandler {
  fetch(request: Request, env: unknown, ctx: ExecutionContext): Promise<Response>;
}

function jsonResponse(
  status: number,
  code: string,
  message: string,
  headers?: HeadersInit,
): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/** The subset of the Workers KV binding the per-site facade wraps. */
export interface ScopedKvBacking {
  get(key: string, options?: unknown): Promise<unknown>;
  getWithMetadata(key: string, options?: unknown): Promise<unknown>;
  put(key: string, value: unknown, options?: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  list(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<{
    keys: { name: string; expiration?: number; metadata?: unknown }[];
    list_complete: boolean;
    cursor?: string;
  }>;
}

/**
 * Wrap the shared functions KV namespace in a per-site key-prefix facade
 * (`site:<siteId>:`) so a site's `env.KV` can only touch its OWN keys — cross-tenant
 * isolation at the key layer (ADR-0035 §6, Stage 4.1(b): the "siteId-prefixed over a
 * shared namespace" shim, NOT a raw namespace binding). `get`/`put`/`delete`/
 * `getWithMetadata` transparently prefix the key; `list()` scopes to the site prefix
 * AND strips it from returned key names so the owner sees a clean namespace. Pure
 * over the backing binding.
 *
 * @param kv - the raw shared KV binding (`__PS_KV`)
 * @param siteId - the owner site id (`__PS_SITE_ID`) — the isolation boundary
 * @example makeScopedKV(sharedKv, 'abc').put('theme', 'dark') // writes key 'site:abc:theme'
 */
export function makeScopedKV(kv: ScopedKvBacking, siteId: string): ScopedKvBacking {
  const prefix = `site:${siteId}:`;
  return {
    get: (key, options) => kv.get(prefix + key, options),
    getWithMetadata: (key, options) => kv.getWithMetadata(prefix + key, options),
    put: (key, value, options) => kv.put(prefix + key, value, options),
    delete: (key) => kv.delete(prefix + key),
    list: async (options = {}) => {
      const res = await kv.list({ ...options, prefix: prefix + (options.prefix ?? '') });
      return {
        ...res,
        keys: res.keys.map((k) => ({ ...k, name: k.name.slice(prefix.length) })),
      };
    },
  };
}

/**
 * Build the SCOPED env every user handler receives (ADR-0035 §6, Stage 4.1).
 *
 * The platform passes the raw WfP script bindings as `env`; this wraps them into
 * the namespaced runtime contract the ADR promises — starting with **`env.SECRETS`**:
 * the site+org env-vars, injected at deploy time as a single `secret_text` binding
 * `__PS_SECRETS_JSON` and parsed here (once per request) into a frozen object so
 * user code reads `env.SECRETS.<KEY>`. Internal `__PS_*` bindings are STRIPPED so
 * they never reach user code — this same seam later hosts the tenant-scoping
 * `env.KV`/`env.R2`/`env.AI`/`env.DATA` shims. Fail-soft: a malformed/absent blob
 * yields `env.SECRETS = {}`, never a throw.
 *
 * @param rawEnv - the raw WfP script env (bindings)
 * @returns a NEW env object exposing the scoped bindings; the platform env is never mutated
 * @example buildFunctionsEnv({ __PS_SECRETS_JSON: '{"API_KEY":"x"}' }).SECRETS // { API_KEY: 'x' }
 */
export function buildFunctionsEnv(rawEnv: unknown): Record<string, unknown> {
  const env = (rawEnv && typeof rawEnv === 'object' ? rawEnv : {}) as Record<string, unknown>;

  let secrets: Record<string, string> = {};
  const raw = env.__PS_SECRETS_JSON;
  if (typeof raw === 'string' && raw.length > 0) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        secrets = parsed as Record<string, string>;
      }
    } catch {
      /* fail-soft — a malformed blob yields an empty SECRETS, never a crash */
    }
  }

  const scoped: Record<string, unknown> = {};
  for (const key of Object.keys(env)) {
    // Internal platform bindings (`__PS_*`) are the raw values the scoped shims
    // wrap — never expose them to user code.
    if (key.startsWith('__PS_')) continue;
    scoped[key] = env[key];
  }
  scoped.SECRETS = Object.freeze(secrets);

  // Stage 4.1(b) — env.KV: a per-site key-prefix facade over the shared functions
  // KV namespace (`__PS_KV`), scoped by `__PS_SITE_ID`. Every key is namespaced
  // `site:<siteId>:` so a site can NEVER read/write another site's keys. Absent
  // bindings (KV not configured, or no siteId) → no `env.KV` (fail-soft).
  const siteId = typeof env.__PS_SITE_ID === 'string' ? env.__PS_SITE_ID : '';
  if (env.__PS_KV && siteId) {
    scoped.KV = makeScopedKV(env.__PS_KV as ScopedKvBacking, siteId);
  }

  return scoped;
}

/**
 * Build a Worker fetch handler that dispatches requests across a functions
 * manifest: matches the path, extracts params, and invokes the method handler.
 * Returns 404 (no route), 405 (route but wrong method), or 500 (handler threw).
 *
 * @param manifest - route pattern → user module, produced by the codegen
 * @example export default createFunctionsFetchHandler([{ pattern: '/api/hello', module }])
 */
export function createFunctionsFetchHandler(
  manifest: FunctionManifestEntry[],
): FunctionsFetchHandler {
  const routes = compileRoutes(manifest.map((entry) => entry.pattern));
  const byPattern = new Map(manifest.map((entry) => [entry.pattern, entry.module]));

  return {
    async fetch(request, env, ctx) {
      const url = new URL(request.url);
      const match = matchCompiledRoutes(routes, url.pathname);
      if (!match) return jsonResponse(404, 'NOT_FOUND', `No function matches ${url.pathname}`);

      const mod = byPattern.get(match.route.pattern);
      if (!mod) return jsonResponse(404, 'NOT_FOUND', `No function matches ${url.pathname}`);

      const handler = selectHandler(mod, request.method);
      if (!handler) {
        return jsonResponse(
          405,
          'METHOD_NOT_ALLOWED',
          `${request.method} is not supported for ${url.pathname}`,
          { Allow: allowedMethods(mod).join(', ') },
        );
      }

      const context: FunctionContext = {
        request,
        // Stage 4.1 — hand the SCOPED env (env.SECRETS + future KV/R2/AI/DATA
        // shims), never the raw platform bindings.
        env: buildFunctionsEnv(env),
        params: match.params,
        waitUntil: (promise) => ctx.waitUntil(promise),
        next: async () =>
          jsonResponse(404, 'NOT_FOUND', `No downstream handler for ${url.pathname}`),
      };

      try {
        return await handler(context);
      } catch (err) {
        return jsonResponse(
          500,
          'FUNCTION_ERROR',
          err instanceof Error ? err.message : 'Function handler threw',
        );
      }
    },
  };
}
