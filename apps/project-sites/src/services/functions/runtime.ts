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

/** The subset of the Workers R2 bucket binding the per-site facade wraps. */
export interface ScopedR2Backing {
  get(key: string, options?: unknown): Promise<unknown>;
  put(key: string, value: unknown, options?: unknown): Promise<unknown>;
  head(key: string): Promise<unknown>;
  delete(keys: string | string[]): Promise<void>;
  list(options?: {
    prefix?: string;
    limit?: number;
    cursor?: string;
    delimiter?: string;
  }): Promise<{
    objects: { key: string; [k: string]: unknown }[];
    truncated: boolean;
    cursor?: string;
    delimitedPrefixes?: string[];
  }>;
}

/**
 * Wrap the platform R2 bucket in a per-site OBJECT-prefix facade
 * (`sites-data/<siteId>/`) so a site's `env.R2` can only read/write its OWN
 * objects — cross-tenant isolation at the key layer (ADR-0035 §6, Stage 4.1(c)).
 * `get`/`put`/`head`/`delete` transparently prefix the key (delete also maps an
 * array); `list()` scopes to the site prefix AND strips it from returned object
 * keys + delimited prefixes so the owner sees a clean namespace. The raw bucket
 * (holding every site's assets) is NEVER exposed — only this facade. Pure over
 * the backing binding.
 *
 * @param bucket - the raw platform R2 binding (`__PS_R2`)
 * @param siteId - the owner site id (`__PS_SITE_ID`) — the isolation boundary
 * @example makeScopedR2(bucket, 'abc').put('report.json', body) // writes 'sites-data/abc/report.json'
 */
export function makeScopedR2(bucket: ScopedR2Backing, siteId: string): ScopedR2Backing {
  const prefix = `sites-data/${siteId}/`;
  const strip = (k: string): string => (k.startsWith(prefix) ? k.slice(prefix.length) : k);
  return {
    get: (key, options) => bucket.get(prefix + key, options),
    put: (key, value, options) => bucket.put(prefix + key, value, options),
    head: (key) => bucket.head(prefix + key),
    delete: (keys) =>
      bucket.delete(Array.isArray(keys) ? keys.map((k) => prefix + k) : prefix + keys),
    list: async (options = {}) => {
      const res = await bucket.list({ ...options, prefix: prefix + (options.prefix ?? '') });
      return {
        ...res,
        objects: res.objects.map((o) => {
          const rec = o as unknown as Record<string, unknown>;
          return { ...rec, key: strip(String(rec.key)) };
        }),
        delimitedPrefixes: res.delimitedPrefixes?.map(strip),
      };
    },
  };
}

/** The `env.AI` facade — a debit-then-call over the platform internal endpoint. */
export interface ScopedAI {
  run(model: string, inputs?: unknown): Promise<unknown>;
}

/** The platform SERVICE binding (`__PS_SVC`) the `env.AI` shim calls in-process. */
export interface ScopedAIService {
  fetch(request: Request): Promise<Response>;
}

/**
 * `env.AI` — a METERED Workers-AI facade (ADR-0035 §6/§8, Stage 4.1(d)). Rather
 * than a RAW (unmetered) `ai` binding, `run()` calls the platform's signed internal
 * endpoint `/api/_ps/ai/run` — over a SERVICE BINDING (`__PS_SVC`), in-process, NOT
 * a public fetch (a WfP user script fetching the platform's own workers.dev reenters
 * the account + 522s). The platform verifies the per-site token, checks credits, runs
 * the model, and debits. Throws a clear Error when out of credits / on any non-2xx.
 *
 * @param token - the per-site function token (`__PS_FN_TOKEN`, `<siteId>.<hmac>`)
 * @param svc - the platform service binding (`__PS_SVC`)
 * @example await env.AI.run('@cf/meta/llama-3.1-8b-instruct-fp8', { prompt: 'hi' })
 */
export function makeScopedAI(token: string, svc: ScopedAIService): ScopedAI {
  return {
    run: async (model, inputs) => {
      // In-process service-binding call — host is a placeholder; the platform
      // routes on the PATH (`/api/_ps/ai/run`), which is registered before the
      // /api/* dispatch catch-all so it wins.
      const res = await svc.fetch(
        new Request('https://ps-internal/api/_ps/ai/run', {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
          body: JSON.stringify({ model, inputs: inputs ?? {} }),
        }),
      );
      const data = (await res.json().catch(() => ({}))) as {
        result?: unknown;
        error?: { message?: string };
      };
      if (!res.ok) throw new Error(data?.error?.message || `env.AI.run failed (${res.status})`);
      return data.result;
    },
  };
}

/** The `env.DATA` facade — read-only, tenant-scoped access to the site's own data. */
export interface ScopedData {
  /** The site's form submissions, newest first (`limit` clamped to [1,100], default 20). */
  forms: { list(opts?: { limit?: number }): Promise<unknown[]> };
  /** The site's own read-only metadata (id, slug, business name/address, status). */
  site(): Promise<unknown>;
}

/**
 * `env.DATA` — READ-ONLY, tenant-scoped site data (ADR-0035 §9, Stage 4.1(e)). Like
 * `env.AI` it calls the platform's signed internal endpoints over the `__PS_SVC` SERVICE
 * binding (in-process, not a public fetch): `forms.list({limit})` → GET
 * `/api/_ps/data/forms`, `site()` → GET `/api/_ps/data/site`. The platform scopes every
 * read to the token's siteId — user code gets NO raw SQL and can NEVER read another
 * site's data. Throws a clear Error on any non-2xx.
 *
 * @param token - the per-site function token (`__PS_FN_TOKEN`, `<siteId>.<hmac>`)
 * @param svc - the platform service binding (`__PS_SVC`)
 * @example await env.DATA.forms.list({ limit: 10 }); await env.DATA.site();
 */
export function makeScopedData(token: string, svc: ScopedAIService): ScopedData {
  const get = async (path: string): Promise<Record<string, unknown>> => {
    const res = await svc.fetch(
      new Request('https://ps-internal' + path, {
        method: 'GET',
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown> & {
      error?: { message?: string };
    };
    if (!res.ok) throw new Error(data?.error?.message || `env.DATA failed (${res.status})`);
    return data;
  };
  return {
    forms: {
      list: async (opts = {}) => {
        const limit = Math.max(1, Math.min(100, opts.limit ?? 20));
        const data = await get(`/api/_ps/data/forms?limit=${limit}`);
        return Array.isArray(data.items) ? data.items : [];
      },
    },
    site: async () => (await get('/api/_ps/data/site')).site ?? null,
  };
}

/** Extract a platform session token from the incoming request (Bearer or `session` cookie). */
export function extractSessionToken(request: Request): string {
  const auth = request.headers.get('authorization') ?? '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  const cookie = request.headers.get('cookie') ?? '';
  const m = cookie.match(/(?:^|;\s*)session=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

/** The opt-in `ctx.verifyOwnerSession()` + `ctx.verifyTurnstile()` helpers (Stage 4.2b). */
export interface CtxAuthHelpers {
  verifyOwnerSession: () => Promise<{ authenticated: boolean; userId?: string; orgId?: string }>;
  verifyTurnstile: (token: string) => Promise<{ success: boolean }>;
}

/**
 * Build the opt-in `ctx` auth helpers (ADR-0035 §108/§109, Stage 4.2b) over the
 * signed-token + `__PS_SVC` service binding plane. `verifyOwnerSession` forwards
 * the end-user's session token (Bearer / `session` cookie, from the request that
 * hit the endpoint) to `/api/_ps/auth/verify-session`; `verifyTurnstile` posts a
 * Turnstile token to `/api/_ps/turnstile/verify`. Both fail CLOSED (`false`) on
 * any fault — a helper that can't reach the platform denies rather than admits.
 *
 * @param token - the per-site function token (`__PS_FN_TOKEN`)
 * @param svc - the platform service binding (`__PS_SVC`)
 * @param request - the inbound request (source of the session token + client IP)
 * @example if (!(await ctx.verifyOwnerSession()).authenticated) return new Response('Forbidden', { status: 403 });
 */
export function makeCtxAuthHelpers(
  token: string,
  svc: ScopedAIService,
  request: Request,
): CtxAuthHelpers {
  const post = async (
    path: string,
    payload: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    try {
      const res = await svc.fetch(
        new Request('https://ps-internal' + path, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
          body: JSON.stringify(payload),
        }),
      );
      return (await res.json().catch(() => ({}))) as Record<string, unknown>;
    } catch {
      return {};
    }
  };
  return {
    verifyOwnerSession: async () => {
      const data = await post('/api/_ps/auth/verify-session', {
        session_token: extractSessionToken(request),
      });
      return {
        authenticated: data.authenticated === true,
        userId: typeof data.userId === 'string' ? data.userId : undefined,
        orgId: typeof data.orgId === 'string' ? data.orgId : undefined,
      };
    },
    verifyTurnstile: async (tsToken) => {
      const data = await post('/api/_ps/turnstile/verify', {
        token: tsToken,
        remoteip: request.headers.get('cf-connecting-ip') ?? undefined,
      });
      return { success: data.success === true };
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

  // Stage 4.1(c) — env.R2: a per-site OBJECT-prefix facade (`sites-data/<siteId>/`)
  // over the platform R2 bucket (`__PS_R2`). Every object key is namespaced so a
  // site can NEVER read/write another site's objects. Absent bindings → no env.R2.
  if (env.__PS_R2 && siteId) {
    scoped.R2 = makeScopedR2(env.__PS_R2 as ScopedR2Backing, siteId);
  }

  // Stage 4.1(d) — env.AI: a metered Workers-AI facade over the platform's signed
  // internal endpoint, reached via the `__PS_SVC` SERVICE binding + `__PS_FN_TOKEN`
  // (in-process, not a public fetch — workers.dev reentry 522s). No raw `ai` binding
  // → every call is credit-debited server-side. Absent bindings → no env.AI (fail-soft).
  const fnToken = typeof env.__PS_FN_TOKEN === 'string' ? env.__PS_FN_TOKEN : '';
  const svc = env.__PS_SVC as ScopedAIService | undefined;
  if (fnToken && svc && typeof svc.fetch === 'function') {
    scoped.AI = makeScopedAI(fnToken, svc);
    // Stage 4.1(e) — env.DATA rides the SAME token + service binding as env.AI
    // (read-only tenant-scoped forms + site metadata via `/api/_ps/data/*`).
    scoped.DATA = makeScopedData(fnToken, svc);
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

      // Stage 4.2b — attach the opt-in auth helpers from the RAW env's platform
      // token + service binding (both stripped from `context.env`). Absent → the
      // helpers stay undefined (endpoints are public by default either way).
      const rawEnv = (env && typeof env === 'object' ? env : {}) as Record<string, unknown>;
      const fnToken = typeof rawEnv.__PS_FN_TOKEN === 'string' ? rawEnv.__PS_FN_TOKEN : '';
      const fnSvc = rawEnv.__PS_SVC as ScopedAIService | undefined;
      if (fnToken && fnSvc && typeof fnSvc.fetch === 'function') {
        const helpers = makeCtxAuthHelpers(fnToken, fnSvc, request);
        context.verifyOwnerSession = helpers.verifyOwnerSession;
        context.verifyTurnstile = helpers.verifyTurnstile;
      }

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
