/**
 * Stage 1.1 — file-based router + method dispatch + dynamic params.
 * Convention: Cloudflare Pages Functions style (ADR-0035 §2).
 *   functions/api/quote.ts        -> /api/quote
 *   functions/api/users/[id].ts   -> /api/users/:id
 *   functions/api/[[path]].ts     -> /api/*   (catch-all)
 * Handlers export onRequest / onRequestGet / onRequestPost / ...
 */
import {
  filePathToRoutePattern,
  compileRoutes,
  matchCompiledRoutes,
  handlerNameForMethod,
  selectHandler,
  resolveRequest,
  isReservedFunctionRoute,
} from '../router.js';
import { createFunctionsFetchHandler } from '../runtime.js';
import { generateFunctionsWorkerEntry, FunctionsBuildError } from '../codegen.js';

describe('filePathToRoutePattern', () => {
  it('maps a flat api file to its route', () => {
    expect(filePathToRoutePattern('api/quote.ts')).toBe('/api/quote');
  });
  it('maps a .js file the same as a .ts file', () => {
    expect(filePathToRoutePattern('api/hello.js')).toBe('/api/hello');
  });
  it('collapses index.ts to its directory route', () => {
    expect(filePathToRoutePattern('api/index.ts')).toBe('/api');
    expect(filePathToRoutePattern('api/users/index.ts')).toBe('/api/users');
  });
  it('maps a root index to /', () => {
    expect(filePathToRoutePattern('index.ts')).toBe('/');
  });
  it('converts [id] to a named :id segment', () => {
    expect(filePathToRoutePattern('api/users/[id].ts')).toBe('/api/users/:id');
  });
  it('handles a dynamic segment mid-path', () => {
    expect(filePathToRoutePattern('api/blog/[slug]/comments.ts')).toBe('/api/blog/:slug/comments');
  });
  it('converts [[path]] to a catch-all', () => {
    expect(filePathToRoutePattern('api/[[path]].ts')).toBe('/api/*');
  });
  it('tolerates a leading ./ or / on the file path', () => {
    expect(filePathToRoutePattern('./api/quote.ts')).toBe('/api/quote');
    expect(filePathToRoutePattern('/api/quote.ts')).toBe('/api/quote');
  });
});

describe('route resolution (static / dynamic / catch-all + params)', () => {
  const routes = compileRoutes([
    '/api/quote',
    '/api/users/:id',
    '/api/users/me',
    '/api/blog/:slug/comments',
    '/api/*',
  ]);

  it('matches a static route with empty params', () => {
    const m = matchCompiledRoutes(routes, '/api/quote');
    expect(m?.route.pattern).toBe('/api/quote');
    expect(m?.params).toEqual({});
  });
  it('extracts a dynamic param', () => {
    const m = matchCompiledRoutes(routes, '/api/users/42');
    expect(m?.route.pattern).toBe('/api/users/:id');
    expect(m?.params).toEqual({ id: '42' });
  });
  it('prefers a static route over a dynamic one at the same depth', () => {
    const m = matchCompiledRoutes(routes, '/api/users/me');
    expect(m?.route.pattern).toBe('/api/users/me');
    expect(m?.params).toEqual({});
  });
  it('extracts a mid-path param', () => {
    const m = matchCompiledRoutes(routes, '/api/blog/hello-world/comments');
    expect(m?.route.pattern).toBe('/api/blog/:slug/comments');
    expect(m?.params).toEqual({ slug: 'hello-world' });
  });
  it('falls back to catch-all with the remainder captured', () => {
    const m = matchCompiledRoutes(routes, '/api/anything/deep/here');
    expect(m?.route.pattern).toBe('/api/*');
    expect(m?.params['*']).toBe('anything/deep/here');
  });
  it('normalizes a trailing slash', () => {
    const m = matchCompiledRoutes(routes, '/api/quote/');
    expect(m?.route.pattern).toBe('/api/quote');
  });
  it('URL-decodes a dynamic param', () => {
    const m = matchCompiledRoutes(routes, '/api/users/a%20b');
    expect(m?.params).toEqual({ id: 'a b' });
  });
  it('returns null when nothing matches', () => {
    const bare = compileRoutes(['/api/quote']);
    expect(matchCompiledRoutes(bare, '/api/nope')).toBeNull();
  });
});

describe('method dispatch', () => {
  it('maps HTTP methods to handler export names', () => {
    expect(handlerNameForMethod('GET')).toBe('onRequestGet');
    expect(handlerNameForMethod('post')).toBe('onRequestPost');
    expect(handlerNameForMethod('DELETE')).toBe('onRequestDelete');
  });
  it('selects the method-specific handler when present', () => {
    const g = () => new Response('g');
    const any = () => new Response('any');
    const mod = { onRequestGet: g, onRequest: any };
    expect(selectHandler(mod, 'GET')).toBe(g);
  });
  it('falls back to onRequest when no method-specific handler exists', () => {
    const any = () => new Response('any');
    expect(selectHandler({ onRequest: any }, 'POST')).toBe(any);
  });
  it('returns undefined when neither exists (405 territory)', () => {
    const mod = { onRequestGet: () => new Response('g') };
    expect(selectHandler(mod, 'POST')).toBeUndefined();
  });
});

describe('resolveRequest (match + method combined)', () => {
  const routes = compileRoutes(['/api/quote', '/api/users/:id']);
  const modules = {
    '/api/quote': { onRequestPost: () => new Response('q') },
    '/api/users/:id': { onRequest: () => new Response('u') },
  } as const;
  const lookup = (pattern: string) => (modules as Record<string, unknown>)[pattern];

  it('resolves a matched route + method to a handler name', () => {
    const r = resolveRequest(routes, 'POST', '/api/quote', lookup);
    expect(r.outcome).toBe('matched');
    if (r.outcome === 'matched') expect(r.handlerName).toBe('onRequestPost');
  });
  it('reports not_found for an unknown path', () => {
    expect(resolveRequest(routes, 'GET', '/api/nope', lookup).outcome).toBe('not_found');
  });
  it('reports method_not_allowed when the path matches but the method has no handler', () => {
    const r = resolveRequest(routes, 'GET', '/api/quote', lookup);
    expect(r.outcome).toBe('method_not_allowed');
    if (r.outcome === 'method_not_allowed') expect(r.allow).toContain('POST');
  });
});

describe('createFunctionsFetchHandler (end-to-end dispatch)', () => {
  const manifest = [
    { pattern: '/api/hello', module: { onRequestGet: () => new Response('hi') } },
    {
      pattern: '/api/users/:id',
      module: {
        onRequest: (ctx: { params: Record<string, string> }) => new Response(ctx.params.id),
      },
    },
    {
      pattern: '/api/echo-env',
      module: {
        onRequest: (ctx: { env: { TOKEN?: string } }) => new Response(ctx.env.TOKEN ?? 'no-env'),
      },
    },
  ];
  const handler = createFunctionsFetchHandler(manifest);
  const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;

  it('dispatches a GET to the matching method handler', async () => {
    const res = await handler.fetch(new Request('https://x.dev/api/hello'), {} as never, ctx);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('hi');
  });
  it('passes extracted params into the handler ctx', async () => {
    const res = await handler.fetch(new Request('https://x.dev/api/users/99'), {} as never, ctx);
    expect(await res.text()).toBe('99');
  });
  it('injects env into the handler ctx', async () => {
    const res = await handler.fetch(
      new Request('https://x.dev/api/echo-env'),
      { TOKEN: 'sekret' } as never,
      ctx,
    );
    expect(await res.text()).toBe('sekret');
  });
  it('returns 404 for an unmatched path', async () => {
    const res = await handler.fetch(new Request('https://x.dev/api/missing'), {} as never, ctx);
    expect(res.status).toBe(404);
  });
  it('returns 405 + Allow header for a matched path with the wrong method', async () => {
    const res = await handler.fetch(
      new Request('https://x.dev/api/hello', { method: 'POST' }),
      {} as never,
      ctx,
    );
    expect(res.status).toBe(405);
    expect(res.headers.get('Allow')).toContain('GET');
  });
});

describe('generateFunctionsWorkerEntry (codegen)', () => {
  it('emits imports, a manifest and a default export', () => {
    const { source } = generateFunctionsWorkerEntry(['api/hello.ts', 'api/users/[id].ts'], {
      runtimeImportPath: '/abs/runtime.js',
    });
    // quote style is an impl detail (codegen emits JSON.stringify'd specifiers)
    expect(source).toContain('./api/hello.ts');
    expect(source).toContain('./api/users/[id].ts');
    expect(source).toContain('/api/hello');
    expect(source).toContain('/api/users/:id');
    expect(source).toContain('createFunctionsFetchHandler');
    expect(source).toContain('export default');
    expect(source).toContain('/abs/runtime.js');
  });
  it('throws a build error on a duplicate route collision', () => {
    // api/users/index.ts and api/users.ts both resolve to /api/users
    expect(() =>
      generateFunctionsWorkerEntry(['api/users.ts', 'api/users/index.ts'], {
        runtimeImportPath: '/abs/runtime.js',
      }),
    ).toThrow(FunctionsBuildError);
  });
  it('throws a build error when a file maps to a platform-reserved path', () => {
    for (const reserved of [
      'api/contact-form.ts',
      'api/_ps/beacon.ts',
      'api/events.ts',
      'api/contact-form/[slug].ts',
    ]) {
      expect(() =>
        generateFunctionsWorkerEntry([reserved], { runtimeImportPath: '/abs/runtime.js' }),
      ).toThrow(FunctionsBuildError);
    }
  });
  it('allows non-reserved paths that merely share a prefix substring', () => {
    // /api/eventsy is NOT under the reserved /api/events
    expect(() =>
      generateFunctionsWorkerEntry(['api/eventsy.ts', 'api/quote.ts'], {
        runtimeImportPath: '/abs/runtime.js',
      }),
    ).not.toThrow();
  });
});

describe('isReservedFunctionRoute (platform-owned /api paths)', () => {
  it('reserves the exact platform routes', () => {
    expect(isReservedFunctionRoute('/api/contact-form')).toBe(true);
    expect(isReservedFunctionRoute('/api/events')).toBe(true);
  });
  it('reserves anything under a reserved prefix', () => {
    expect(isReservedFunctionRoute('/api/contact-form/:slug')).toBe(true);
    expect(isReservedFunctionRoute('/api/_ps/anything/deep')).toBe(true);
  });
  it('does NOT reserve user routes that only share a prefix substring', () => {
    expect(isReservedFunctionRoute('/api/eventsy')).toBe(false);
    expect(isReservedFunctionRoute('/api/contact')).toBe(false);
    expect(isReservedFunctionRoute('/api/quote')).toBe(false);
  });
});
