# SearXNG worker — search.projectsites.dev
# Cloudflare Workers Container running SearXNG behind Cloudflare Access.
#
# Proxy: Worker → Container DO → SearXNG on :8080
# /healthz is handled at the Worker layer (no engine calls).
# All other paths are proxied to SearXNG with safe header forwarding.

import { Container, getContainer } from '@cloudflare/containers';

interface Env {
  SEARXNG: DurableObjectNamespace<SearXNGContainer>;
  SEARXNG_SECRET: string;
  SEARXNG_VALKEY_URL: string;
}

export class SearXNGContainer extends Container<Env> {
  override defaultPort = 8080;
  override sleepAfter = '30m';

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.envVars = {
      SEARXNG_SECRET: env.SEARXNG_SECRET,
      SEARXNG_VALKEY_URL: env.SEARXNG_VALKEY_URL,
      SEARXNG_BASE_URL: 'https://search.projectsites.dev/',
      SEARXNG_LIMITER: 'true',
      SEARXNG_PUBLIC_INSTANCE: 'false',
      FORCE_OWNERSHIP: '1',
    };
  }

  override async fetch(request: Request): Promise<Response> {
    // Port-ready timeout generous — image pull + config load for first boot
    await this.startAndWaitForPorts({
      ports: 8080,
      cancellationOptions: {
        portReadyTimeoutMS: 120_000,
        instanceGetTimeoutMS: 30_000,
      },
    });
    return this.containerFetch(request);
  }
}

// ── Redacted-path helper ──────────────────────────────────────────────
// Logs only the path, never the full URL (query strings carry search terms).
const safePath = (url: URL): string => {
  const p = url.pathname;
  // Truncate very long paths (unlikely but defensive)
  return p.length > 200 ? p.slice(0, 197) + '...' : p;
};

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // ── /healthz — process-level only, never triggers upstream engines ──
    if (url.pathname === '/healthz') {
      return new Response('ok\n', {
        status: 200,
        headers: {
          'content-type': 'text/plain; charset=utf-8',
          'cache-control': 'no-store',
        },
      });
    }

    // ── Container not yet provisioned → friendly placeholder ───────────
    if (!env.SEARXNG) {
      return new Response(
        '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="color-scheme" content="dark"><title>Search · ProjectSites</title><style>body{min-height:100vh;background:#060610;color:#f4f4ff;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center}div{text-align:center}h1{font-size:2rem;margin-bottom:.5rem}p{color:#94a3b8}a{color:#00e5ff}</style></head><body><div><h1>Search</h1><p>Search infrastructure is provisioning.</p></div></body></html>',
        { status: 200, headers: { 'Content-Type': 'text/html;charset=utf-8' } },
      );
    }

    // ── Structured log (path only, never query string) ─────────────────
    console.warn(JSON.stringify({
      level: 'info',
      service: 'searxng-proxy',
      path: safePath(url),
      method: request.method,
      cfRay: request.headers.get('cf-ray') ?? undefined,
    }));

    // ── Sanitize request: strip CF-Access JWT from SearXNG logs ────────
    // CF-Access-* headers are for the Worker layer only; don't leak them.
    const proxied = new Request(request);
    proxied.headers.delete('cf-access-jwt-assertion');
    proxied.headers.delete('cf-access-client-id');
    proxied.headers.delete('cf-access-client-secret');

    // Ensure client IP headers are preserved for limiter accuracy
    // CF-Connecting-IP is set by Cloudflare; keep it for SearXNG limiter

    const container = getContainer(env.SEARXNG, 'singleton');
    const response = await container.fetch(proxied);

    // ── Add conservative security headers on proxied responses ─────────
    const secure = new Response(response.body, response);
    secure.headers.set('x-content-type-options', 'nosniff');
    secure.headers.set('x-frame-options', 'DENY');
    secure.headers.set('referrer-policy', 'no-referrer');
    secure.headers.set('x-robots-tag', 'noindex, nofollow');
    // Don't cache search results
    secure.headers.set('cache-control', 'private, no-cache, no-store, must-revalidate');

    return secure;
  },
};
