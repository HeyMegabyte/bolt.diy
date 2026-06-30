/**
 * automation.projectsites.dev — Activepieces automation/workflow hub.
 *
 * Cloudflare Worker front-door proxy → Fly.io Activepieces app.
 * Neon Postgres (`projectsites_activepieces` on Listmonk project) + Upstash Redis.
 *
 * Deploy 2026-06-30 — Fly.io runtime (CF Containers attempted; image ~500MB too heavy for CF Container cold-start).
 * Architecture: CF DNS (proxied) → CF Worker (this) → Fly.io VM (HTTP) → Neon + Upstash.
 */
interface Env {
  FLY_APP_ORIGIN: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const upstream = new URL(url.pathname + url.search, env.FLY_APP_ORIGIN);

    // Build upstream request, preserving method/body
    const upstreamReq = new Request(upstream, {
      method: request.method,
      headers: new Headers(request.headers),
      redirect: 'manual',
    });

    if (request.body) {
      // Reconstruct body for non-GET/HEAD
      upstreamReq.headers.delete('content-length');
    }

    // Forward original client info
    const cfIp = request.headers.get('CF-Connecting-IP');
    if (cfIp) upstreamReq.headers.set('X-Forwarded-For', cfIp);
    upstreamReq.headers.set('X-Forwarded-Proto', 'https');
    upstreamReq.headers.set('X-Forwarded-Host', url.host);
    // Fly routes by Host header
    upstreamReq.headers.set('Host', 'automation.projectsites.dev');

    try {
      const response = await fetch(upstreamReq);
      return response;
    } catch (e) {
      return new Response(
        '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="color-scheme" content="dark"><meta http-equiv="refresh" content="10"><title>Automation · ProjectSites</title><style>body{min-height:100vh;background:#060610;color:#f4f4ff;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center}div{text-align:center}h1{font-size:2rem;margin-bottom:.5rem}p{color:#94a3b8}a{color:#00e5ff}.spinner{width:40px;height:40px;margin:1rem auto;border:3px solid #1e1e3f;border-top-color:#00e5ff;border-radius:50%;animation:s .8s linear infinite}@keyframes s{to{transform:rotate(360deg)}}</style></head><body><div><h1>Automation</h1><p>Workflow engine is starting up…</p><div class="spinner"></div></div></body></html>',
        { status: 503, headers: { 'Content-Type': 'text/html;charset=utf-8' } },
      );
    }
  },
};
