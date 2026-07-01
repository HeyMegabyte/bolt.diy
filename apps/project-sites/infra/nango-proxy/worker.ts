export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') ?? '*';

    // Health check
    if (url.pathname === '/healthcheck') {
      try {
        const r = await fetch('https://projectsites-nango.fly.dev/', { signal: AbortSignal.timeout(5000) });
        return new Response(JSON.stringify({ status: r.ok ? 'healthy' : 'degraded', nangoStatus: r.status, ts: Date.now() }), {
          status: r.ok ? 200 : 503,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true' },
        });
      } catch {
        return new Response(JSON.stringify({ status: 'down', ts: Date.now() }), {
          status: 503,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true' },
        });
      }
    }

    // CORS preflight — must respond before anything else
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Allow-Methods': 'GET,HEAD,PUT,PATCH,POST,DELETE',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Requested-With,Accept,Origin',
          'Access-Control-Allow-Credentials': 'true',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    try {
      const proxyUrl = new URL(request.url);
      proxyUrl.hostname = 'projectsites-nango.fly.dev';
      const body = request.method !== 'GET' && request.method !== 'HEAD'
        ? await request.arrayBuffer().catch(() => null) : null;
      const resp = await fetch(proxyUrl.toString(), {
        method: request.method, headers: request.headers, body,
        signal: AbortSignal.timeout(30000),
      });

      const headers = new Headers(resp.headers);
      headers.delete('Content-Security-Policy');
      headers.delete('Content-Security-Policy-Report-Only');
      headers.delete('content-security-policy');
      headers.delete('content-security-policy-report-only');
      headers.set('Content-Security-Policy', "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; frame-ancestors 'self'");
      headers.set('Access-Control-Allow-Origin', origin);
      headers.set('Access-Control-Allow-Credentials', 'true');
      headers.set('Vary', 'Origin');

      const ct = headers.get('Content-Type') ?? '';
      if (ct.includes('text/html')) {
        let html = await resp.text();
        html = html.replace(
          '<meta name="nango-api-origin" content="" />',
          '<meta name="nango-api-origin" content="https://nango.projectsites.dev" />'
        );
        html = html.replace('</head>',
          `<script>
try{var s=localStorage.getItem("nango_session");if(s){var p=JSON.parse(s);if(!p.state||!p.state.user)localStorage.removeItem("nango_session")}}catch(e){}
Object.defineProperty(window,'Stripe',{value:function(){return{elements:function(){return{create:function(){return{mount:function(){},on:function(){},unmount:function(){}}}}},confirmCardPayment:function(){return Promise.resolve({})},createToken:function(){return Promise.resolve({})}}},writable:false,configurable:false});
</script></head>`
        );
        headers.set('Content-Length', String(new TextEncoder().encode(html).length));
        return new Response(html, { status: resp.status, statusText: resp.statusText, headers });
      }

      return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers });
    } catch {
      return new Response(JSON.stringify({ error: 'Nango unavailable' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true' },
      });
    }
  },
};
