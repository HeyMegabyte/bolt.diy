/**
 * File-based route resolution for a site's `functions/` folder.
 *
 * Cloudflare Pages Functions convention (ADR-0035 §2), JS/TS only in v1:
 *   functions/api/quote.ts       -> /api/quote
 *   functions/api/users/[id].ts  -> /api/users/:id
 *   functions/api/[[path]].ts    -> /api/*   (terminal catch-all)
 *   functions/api/index.ts       -> /api
 *
 * Pure + zero-dependency: the same code runs inside each generated per-site
 * Worker (route dispatch at the edge) AND at build time (codegen). It never
 * imports Worker bindings or Node APIs, so it stays portable across both.
 */

/** Handler export names a functions file may provide. */
export type FunctionHandlerName =
  | 'onRequest'
  | 'onRequestGet'
  | 'onRequestPost'
  | 'onRequestPut'
  | 'onRequestPatch'
  | 'onRequestDelete'
  | 'onRequestHead'
  | 'onRequestOptions';

/** Context object handed to every functions handler (Pages-compatible shape). */
export interface FunctionContext {
  request: Request;
  env: unknown;
  params: Record<string, string>;
  waitUntil: (promise: Promise<unknown>) => void;
  next: () => Promise<Response>;
}

export type FunctionHandler = (ctx: FunctionContext) => Response | Promise<Response>;
export type FunctionModule = Partial<Record<FunctionHandlerName, FunctionHandler>>;

/** A route pattern compiled into a matcher. */
export interface CompiledRoute {
  pattern: string;
  regex: RegExp;
  paramNames: string[];
  specificity: number;
  catchAll: boolean;
}

export interface RouteMatch {
  route: CompiledRoute;
  params: Record<string, string>;
}

const CODE_EXT = /\.(?:ts|tsx|js|jsx|mjs|cjs|mts|cts)$/;

const METHOD_TO_HANDLER: Record<string, FunctionHandlerName> = {
  GET: 'onRequestGet',
  POST: 'onRequestPost',
  PUT: 'onRequestPut',
  PATCH: 'onRequestPatch',
  DELETE: 'onRequestDelete',
  HEAD: 'onRequestHead',
  OPTIONS: 'onRequestOptions',
};

const HANDLER_TO_METHOD: [FunctionHandlerName, string][] = [
  ['onRequestGet', 'GET'],
  ['onRequestPost', 'POST'],
  ['onRequestPut', 'PUT'],
  ['onRequestPatch', 'PATCH'],
  ['onRequestDelete', 'DELETE'],
  ['onRequestHead', 'HEAD'],
  ['onRequestOptions', 'OPTIONS'],
];

const ALL_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

function escapeRegex(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Convert a `functions/`-relative file path into its URL route pattern.
 *
 * @param relPath - path relative to the `functions/` root, e.g. `api/users/[id].ts`
 * @returns the route pattern, e.g. `/api/users/:id` (or `/` for a root index)
 * @example filePathToRoutePattern('api/[[path]].ts') // '/api/*'
 */
export function filePathToRoutePattern(relPath: string): string {
  const stripped = relPath
    .trim()
    .replace(/^\.?\//, '')
    .replace(CODE_EXT, '');
  const segs = stripped.split('/').filter(Boolean);
  if (segs.length && segs[segs.length - 1] === 'index') segs.pop();
  const out = segs.map((seg) => {
    const doubled = seg.match(/^\[\[(.+)\]\]$/);
    if (doubled) return '*';
    const single = seg.match(/^\[(.+)\]$/);
    if (single) return ':' + single[1];
    return seg;
  });
  return '/' + out.join('/');
}

/**
 * `/api/*` prefixes the platform owns on child hosts — a `functions/` file may
 * NOT define these (ADR-0035 §3). Enumerated from the current child-subdomain
 * platform routes: `/api/contact-form/<slug>` (form hijack) + `/api/events`
 * (app.js pageview beacon), plus the reserved `/api/_ps/*` namespace for future
 * platform internals. Shared SSOT: build-time collision rejection (this module +
 * codegen) AND the runtime reserved-path dispatch guard (Stage 3.1 site_serving).
 * Reserved-path policy is a one-way door — never shrink this set silently.
 */
export const RESERVED_FUNCTION_PATH_PREFIXES = ['/api/contact-form', '/api/_ps', '/api/events'];

/**
 * Whether a route pattern falls under a platform-reserved `/api/*` prefix
 * (exact match or a `/`-bounded descendant), so a user function can't shadow it.
 *
 * @example isReservedFunctionRoute('/api/contact-form/:slug') // true
 * @example isReservedFunctionRoute('/api/eventsy')            // false (prefix substring only)
 */
export function isReservedFunctionRoute(pattern: string): boolean {
  return RESERVED_FUNCTION_PATH_PREFIXES.some(
    (prefix) => pattern === prefix || pattern.startsWith(prefix + '/'),
  );
}

/**
 * Compile a single route pattern into a matcher with a specificity score.
 * Static segments score higher than dynamic; catch-all sorts last.
 */
export function compilePattern(pattern: string): CompiledRoute {
  const segs = pattern.split('/').filter(Boolean);
  const paramNames: string[] = [];
  let catchAll = false;
  let specificity = 0;
  const parts = segs.map((seg) => {
    if (seg === '*') {
      catchAll = true;
      paramNames.push('*');
      return '(.*)';
    }
    if (seg.startsWith(':')) {
      paramNames.push(seg.slice(1));
      specificity += 1;
      return '([^/]+)';
    }
    specificity += 10;
    return escapeRegex(seg);
  });
  if (catchAll) specificity -= 1000;
  const body = parts.length ? '/' + parts.join('/') : '/';
  return { pattern, regex: new RegExp('^' + body + '/?$'), paramNames, specificity, catchAll };
}

/**
 * Compile a list of route patterns, sorted most-specific first so a static
 * route always wins over a dynamic route at the same depth.
 */
export function compileRoutes(patterns: string[]): CompiledRoute[] {
  return patterns.map(compilePattern).sort((a, b) => b.specificity - a.specificity);
}

function normalizePath(pathname: string): string {
  const p = pathname || '/';
  return p.startsWith('/') ? p : '/' + p;
}

/**
 * Match a pathname against compiled routes, returning the winning route and
 * its extracted (URL-decoded) params, or null when nothing matches.
 */
export function matchCompiledRoutes(routes: CompiledRoute[], pathname: string): RouteMatch | null {
  const path = normalizePath(pathname);
  for (const route of routes) {
    const m = route.regex.exec(path);
    if (!m) continue;
    const params: Record<string, string> = {};
    route.paramNames.forEach((name, i) => {
      let value = m[i + 1] ?? '';
      if (route.catchAll && name === '*') value = value.replace(/\/$/, '');
      try {
        value = decodeURIComponent(value);
      } catch {
        /* malformed encoding — keep raw */
      }
      params[name] = value;
    });
    return { route, params };
  }
  return null;
}

/** Map an HTTP method to its method-specific handler export name. */
export function handlerNameForMethod(method: string): FunctionHandlerName {
  return METHOD_TO_HANDLER[method.toUpperCase()] ?? 'onRequest';
}

/**
 * Pick the handler for a method: the method-specific export if present,
 * else the catch-all `onRequest`, else undefined (→ 405).
 */
export function selectHandler(mod: FunctionModule, method: string): FunctionHandler | undefined {
  const specific = mod[handlerNameForMethod(method)];
  if (typeof specific === 'function') return specific;
  if (typeof mod.onRequest === 'function') return mod.onRequest;
  return undefined;
}

/** The HTTP methods a module can serve — powers the 405 `Allow` header. */
export function allowedMethods(mod: FunctionModule): string[] {
  const methods: string[] = [];
  for (const [fn, verb] of HANDLER_TO_METHOD) {
    if (typeof mod[fn] === 'function') methods.push(verb);
  }
  if (typeof mod.onRequest === 'function') {
    for (const verb of ALL_METHODS) if (!methods.includes(verb)) methods.push(verb);
  }
  return methods;
}

/** Combined match + method dispatch outcome. */
export type ResolveResult =
  | {
      outcome: 'matched';
      route: CompiledRoute;
      params: Record<string, string>;
      handlerName: FunctionHandlerName;
      handler: FunctionHandler;
    }
  | {
      outcome: 'method_not_allowed';
      route: CompiledRoute;
      params: Record<string, string>;
      allow: string[];
    }
  | { outcome: 'not_found' };

/**
 * Resolve a request to a handler: match the path, then dispatch by method.
 *
 * @param lookup - resolves a route pattern to its module (the codegen manifest)
 */
export function resolveRequest(
  routes: CompiledRoute[],
  method: string,
  pathname: string,
  lookup: (pattern: string) => FunctionModule | undefined,
): ResolveResult {
  const match = matchCompiledRoutes(routes, pathname);
  if (!match) return { outcome: 'not_found' };
  const mod = lookup(match.route.pattern);
  if (!mod) return { outcome: 'not_found' };
  const handler = selectHandler(mod, method);
  if (!handler) {
    return {
      outcome: 'method_not_allowed',
      route: match.route,
      params: match.params,
      allow: allowedMethods(mod),
    };
  }
  const name = handlerNameForMethod(method);
  const handlerName: FunctionHandlerName = typeof mod[name] === 'function' ? name : 'onRequest';
  return { outcome: 'matched', route: match.route, params: match.params, handlerName, handler };
}
