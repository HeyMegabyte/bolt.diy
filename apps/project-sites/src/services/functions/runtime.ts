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
        env,
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
