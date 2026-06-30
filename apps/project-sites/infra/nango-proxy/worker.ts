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

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': request.headers.get('Origin') ?? '*',
          'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
          'Access-Control-Allow-Headers': '*',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    // Proxy to Nango, stripping CSP and adding CORS
    try {
      const proxyUrl = new URL(request.url);
      proxyUrl.hostname = 'projectsites-nango.fly.dev';
      const body = request.method !== 'GET' && request.method !== 'HEAD'
        ? await request.arrayBuffer().catch(() => null) : null;
      const resp = await fetch(proxyUrl.toString(), {
        method: request.method,
        headers: request.headers,
        body,
        signal: AbortSignal.timeout(30000),
      });

      const headers = new Headers(resp.headers);
      // Strip Nango's restrictive CSP, replace with permissive
      headers.delete('Content-Security-Policy');
      headers.delete('Content-Security-Policy-Report-Only');
      headers.set('Content-Security-Policy', "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; frame-ancestors 'self'");
      // CORS
      headers.set('Access-Control-Allow-Origin', request.headers.get('Origin') ?? '*');
      headers.set('Access-Control-Allow-Credentials', 'true');
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
