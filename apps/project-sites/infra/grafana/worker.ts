/**
 * grafana.projectsites.dev — Grafana observability dashboard.
 *
 * @remarks
 * Grafana runs on Fly.io (projectsites-grafana.fly.dev) with SQLite + persistent volume.
 * The CF Worker acts as a reverse proxy front door that rewrites anonymous GET / to /login
 * so the root URL returns Grafana's login page (200), not a redirect.
 *
 * Hosting: Fly.io (CF Containers had a firecracker runtime incompatibility — Grafana
 * 12.2.10 hangs on container startup; works perfectly on Fly's standard Docker runtime).
 * DB: SQLite on Fly volume (Neon Postgres blocked by Grafana's lib/pq SCRAM-SHA-256 driver
 * incompatibility with Neon's i=1 iteration count, and pgbouncer breaks prepared statements).
 */
interface Env {
  /** Fly.io Grafana URL */
  GRAFANA_UPSTREAM_URL: string;
}

const DEFAULT_UPSTREAM = 'https://projectsites-grafana.fly.dev';

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
    proxyReq.headers.set('Host', 'grafana.projectsites.dev');
    proxyReq.headers.set('X-Forwarded-Host', 'grafana.projectsites.dev');
    proxyReq.headers.set('X-Forwarded-Proto', 'https');
    proxyReq.headers.set('X-Real-IP', request.headers.get('CF-Connecting-IP') || '');

    try {
      const upstream = await fetch(proxyReq);
      const resp = new Response(upstream.body, upstream);

      // Never cache authenticated pages
      if (resp.headers.get('Set-Cookie')?.includes('grafana_session')) {
        resp.headers.set('Cache-Control', 'private, no-cache, no-store, must-revalidate');
      }

      return resp;
    } catch (err) {
      console.error('[grafana proxy error]', err instanceof Error ? err.message : String(err));
      return new Response('Grafana upstream unreachable', { status: 502 });
    }
  },
};
