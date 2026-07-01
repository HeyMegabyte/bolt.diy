/**
 * grafana.projectsites.dev — Grafana observability dashboard.
 *
 * @remarks
 * Grafana runs on Fly.io (projectsites-grafana.fly.dev) with SQLite + persistent volume.
 * The CF Worker acts as a reverse proxy front door that rewrites anonymous GET / to /login
 * so the root URL returns Grafana's login page (200), not a redirect.
 *
 * Cookie handling: Set-Cookie Domain attributes are stripped so the browser scopes
 * cookies to grafana.projectsites.dev (not the upstream Fly domain).
 *
 * Hosting: Fly.io (CF Containers had a firecracker runtime incompatibility).
 */
interface Env {
  GRAFANA_UPSTREAM_URL: string;
}

const DEFAULT_UPSTREAM = 'https://projectsites-grafana.fly.dev';

/**
 * Strip `Domain=<value>` from each Set-Cookie header so the cookie
 * scopes to the proxied hostname instead of the upstream Fly domain.
 * Also strips `Secure` if present since the edge already enforces HTTPS.
 */
function rewriteSetCookie(setCookie: string | null): string | null {
  if (!setCookie) return null;
  return setCookie
    .split(',')
    .map(c => c.trim())
    .map(c => c.replace(/;\s*Domain=[^;]*/gi, ''))
    .join(', ');
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const upstreamBase = env.GRAFANA_UPSTREAM_URL || DEFAULT_UPSTREAM;

    // /ping — lightweight health check (no upstream needed)
    if (url.pathname === '/ping') {
      return new Response(JSON.stringify({ ok: true, time: Date.now() }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Anonymous GET / → /login rewrite
    const hasGrafanaSession =
      request.headers.get('Cookie')?.includes('grafana_session') ?? false;
    const isWebSocket = request.headers.get('Upgrade')?.toLowerCase() === 'websocket';

    if (request.method === 'GET' && url.pathname === '/' && !hasGrafanaSession && !isWebSocket) {
      url.pathname = '/login';
    }

    // Build upstream URL
    const upstreamUrl = new URL(url.pathname + url.search, upstreamBase);

    // Forward request to Fly.io Grafana
    const proxyReq = new Request(upstreamUrl, request);
    proxyReq.headers.set('Host', upstreamUrl.host);
    proxyReq.headers.set('X-Forwarded-Host', 'grafana.projectsites.dev');
    proxyReq.headers.set('X-Forwarded-Proto', 'https');
    proxyReq.headers.set('X-Real-IP', request.headers.get('CF-Connecting-IP') || '');
    // Preserve the original Origin so Grafana's CSRF check passes
    if (request.headers.get('Origin')) {
      proxyReq.headers.set('Origin', request.headers.get('Origin')!);
    }
    if (request.headers.get('Referer')) {
      proxyReq.headers.set('Referer', request.headers.get('Referer')!);
    }

    try {
      const upstream = await fetch(proxyReq);
      const headers = new Headers(upstream.headers);

      // Strip Domain from Set-Cookie so cookies scope to grafana.projectsites.dev
      const rawSetCookie = upstream.headers.get('Set-Cookie');
      if (rawSetCookie) {
        headers.set('Set-Cookie', rewriteSetCookie(rawSetCookie) ?? '');
      }

      // Remove Fly.io-specific headers
      headers.delete('fly-request-id');
      headers.delete('fly-region');
      headers.delete('server');
      headers.delete('via');

      // Never cache authenticated pages
      if (rawSetCookie?.includes('grafana_session')) {
        headers.set('Cache-Control', 'private, no-cache, no-store, must-revalidate');
      }

      return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers,
      });
    } catch (err) {
      console.error('[grafana proxy error]', err instanceof Error ? err.message : String(err));
      return new Response('Grafana upstream unreachable', { status: 502 });
    }
  },
};
