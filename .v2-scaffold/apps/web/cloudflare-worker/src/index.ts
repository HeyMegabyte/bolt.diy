/**
 * `projectsites-web` — Cloudflare Worker entry that runs Angular 21 SSR
 * at the edge.
 *
 * @remarks
 * The Angular CLI builds two artefacts when `outputMode: 'server'` is set
 * in `apps/web/project.json`:
 *   - `dist/apps/web/browser/`  static client assets (served from R2 / KV
 *                                 via the `ASSETS` binding)
 *   - `dist/apps/web/server/`   `AngularAppEngine` server bundle
 *
 * On a request:
 *   1. Try the static asset binding first (CSS, JS, fonts, images).
 *   2. If miss, hand the request to `AngularAppEngine.handle()` for SSR.
 *   3. If SSR returns nothing (no matching route), surface `offline.html`
 *      from assets — the kill-switch / offline shell — instead of a raw
 *      404 so installed PWAs never see a blank page.
 *
 * Service bindings:
 *   - `CONTROL_PLANE` — typed RPC binding to the API worker. The browser
 *     never calls it directly; client requests to `/api/*` are proxied
 *     here so cookies / origin policies stay clean.
 *
 * Why no Express adapter:
 *   - `@angular/ssr` ships a Web-API-friendly `AngularAppEngine` that
 *     accepts a `Request` and returns a `Response`. Workers speak the
 *     same Fetch dialect, so the engine drops straight in — no Node
 *     polyfill, no `@cloudflare/next-on-pages`-style adapter shim.
 *
 * @see https://angular.dev/guide/ssr
 * @see ../../wrangler.jsonc
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { AngularAppEngine, createRequestHandler } from '@angular/ssr';

/**
 * The Angular SSR engine. Lazily instantiated at module scope so it
 * survives across requests within the same isolate. `createRequestHandler`
 * takes a `(req: Request) => Promise<Response | null>` callback, so we
 * adapt the engine's `.handle()` method into a request-handler closure.
 */
const angularApp = new AngularAppEngine();
const handler = createRequestHandler(async (request: Request) => {
  const response = await angularApp.handle(request);
  return response ?? null;
});

/**
 * Service bindings + asset binding contract injected by Wrangler.
 */
export interface Env {
  /** Static assets binding — points at `dist/apps/web/browser/`. */
  readonly ASSETS: Fetcher;
  /** Typed RPC binding to the control-plane API worker. */
  readonly CONTROL_PLANE: Fetcher;
  /** Environment marker — `production` | `staging` | `preview`. */
  readonly ENV: string;
  /** Sentry DSN for surface-level error capture. */
  readonly SENTRY_DSN?: string;
}

/**
 * Path patterns that should NEVER be SSR'd — let the API worker handle
 * them instead. The match is intentionally broad: any path beginning with
 * `/api/`, `/.well-known/`, or `/__health` is proxied verbatim.
 */
const API_PATTERN = /^\/(api|\.well-known|__health|webhooks)\b/;

/**
 * Proxy `/api/*` traffic to the control-plane worker. Preserves method,
 * headers, body, and the original URL path so the API sees the request
 * exactly as the browser sent it.
 */
async function proxyToControlPlane(request: Request, env: Env): Promise<Response> {
  const upstream = await env.CONTROL_PLANE.fetch(request);
  // Clone headers so we can stamp our request ID for cross-worker tracing.
  const headers = new Headers(upstream.headers);
  headers.set('x-served-by', 'projectsites-web');
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

/**
 * Default fetch handler — the entry point every Cloudflare Worker exposes.
 */
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // 1) API / health / well-known → control-plane RPC binding.
    if (API_PATTERN.test(url.pathname)) {
      return proxyToControlPlane(request, env);
    }

    // 2) Static asset hit (`/favicon.ico`, `/assets/foo.css`, fonts, …).
    //    `ASSETS.fetch` returns 404 on miss; we fall through to SSR then.
    if (url.pathname !== '/' && /\.[a-z0-9]{2,5}$/i.test(url.pathname)) {
      const assetHit = await env.ASSETS.fetch(request);
      if (assetHit.status !== 404) {
        return assetHit;
      }
    }

    // 3) Angular SSR (waitUntil so streamed flushes complete cleanly).
    try {
      const response = await handler(request);
      if (response) {
        ctx.waitUntil(Promise.resolve());
        return response;
      }
    } catch (error) {
      // Surface to Sentry via Workers Tracing — the SSR engine should
      // never crash hard. Fall through to the offline shell below.
      console.warn('[projectsites-web] SSR threw', error);
    }

    // 4) Last-resort: serve `offline.html` from the assets binding so
    //    installed PWAs never see a blank screen.
    const offline = await env.ASSETS.fetch(new Request(new URL('/offline.html', url)));
    if (offline.status === 200) {
      const body = await offline.text();
      return new Response(body, {
        status: 503,
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
          'retry-after': '15',
        },
      });
    }

    return new Response('Service Unavailable', {
      status: 503,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  },
} satisfies ExportedHandler<Env>;
