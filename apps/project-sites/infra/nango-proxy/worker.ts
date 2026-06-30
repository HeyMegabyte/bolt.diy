/**
 * nango.projectsites.dev — Proxy to Fly.io Nango.
 * Always-on (no cold starts), CSP suppression, health check.
 */
export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Health check
    if (path === '/healthcheck') {
      try {
        const resp = await fetch('https://projectsites-nango.fly.dev/', { signal: AbortSignal.timeout(5000) });
        return new Response(JSON.stringify({ status: resp.ok ? 'healthy' : 'degraded', nangoStatus: resp.status, ts: Date.now() }), {
          status: resp.ok ? 200 : 503,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      } catch {
        return new Response(JSON.stringify({ status: 'down', ts: Date.now() }), {
          status: 503,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }
    }

    // Proxy to Nango
    try {
      const proxyUrl = new URL(request.url);
      proxyUrl.hostname = 'projectsites-nango.fly.dev';
      const resp = await fetch(proxyUrl.toString(), {
        method: request.method,
        headers: request.headers,
        body: request.method !== 'GET' && request.method !== 'HEAD' ? await request.arrayBuffer().catch(() => null) : null,
        signal: AbortSignal.timeout(30000),
      });

      // Suppress CSP report-only noise by adding permissive CSP
      const headers = new Headers(resp.headers);
      headers.set('Content-Security-Policy', "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; script-src * 'unsafe-inline' 'unsafe-eval'; connect-src *; img-src * data: blob:; style-src * 'unsafe-inline';");
      headers.set('Access-Control-Allow-Origin', '*');
      headers.set('X-Nango-Proxy', 'cf-worker');
      return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers });
    } catch {
      return new Response(JSON.stringify({ error: 'Nango unavailable' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }
  },
};
