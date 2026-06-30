import { Container, getContainer } from '@cloudflare/containers';

/**
 * grafana.projectsites.dev — Grafana observability dashboard on Cloudflare Workers Containers.
 *
 * @remarks
 * Stateless Grafana container backed by Neon Postgres (jolly-pine-24431114 / grafana).
 * The Worker front door rewrites anonymous GET / to /login so the root URL returns
 * Grafana's login page (200), not a redirect. Authenticated users with a grafana_session
 * cookie see the normal dashboard. Health checks proxy to /api/health.
 */
interface Env {
  GRAFANA: DurableObjectNamespace<Grafana>;
  /** Neon Postgres pooled host (ep-round-wildflower-aigybxdk-pooler.c-4.us-east-1.aws.neon.tech) */
  GRAFANA_DATABASE_HOST: string;
  GRAFANA_DATABASE_NAME: string;
  GRAFANA_DATABASE_USER: string;
  GRAFANA_DATABASE_PASSWORD: string;
  GRAFANA_DATABASE_SSL_MODE: string;
  GRAFANA_ADMIN_PASSWORD: string;
  GRAFANA_SECURITY_SECRET_KEY: string;
}

const WEB_URL = 'https://grafana.projectsites.dev';

export class Grafana extends Container<Env> {
  override defaultPort = 3000;
  override sleepAfter = '1h';

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.envVars = {
      GF_SERVER_DOMAIN: 'grafana.projectsites.dev',
      GF_SERVER_ROOT_URL: 'https://grafana.projectsites.dev/',
      GF_SERVER_HTTP_PORT: '3000',
      GF_SERVER_ENFORCE_DOMAIN: 'true',
      GF_SERVER_ENABLE_GZIP: 'true',

      GF_SECURITY_ADMIN_USER: 'admin',
      GF_SECURITY_ADMIN_PASSWORD: env.GRAFANA_ADMIN_PASSWORD,
      GF_SECURITY_SECRET_KEY: env.GRAFANA_SECURITY_SECRET_KEY,
      GF_SECURITY_COOKIE_SECURE: 'true',
      GF_SECURITY_COOKIE_SAMESITE: 'lax',
      GF_SECURITY_DISABLE_GRAVATAR: 'true',
      GF_SECURITY_ALLOW_EMBEDDING: 'false',

      GF_AUTH_DISABLE_LOGIN_FORM: 'false',
      GF_AUTH_ANONYMOUS_ENABLED: 'false',
      GF_AUTH_BASIC_ENABLED: 'true',

      GF_USERS_ALLOW_SIGN_UP: 'false',
      GF_USERS_ALLOW_ORG_CREATE: 'false',

      GF_LOG_MODE: 'console',
      GF_LOG_LEVEL: 'info',

      GF_ANALYTICS_REPORTING_ENABLED: 'false',
      GF_ANALYTICS_CHECK_FOR_UPDATES: 'false',
      GF_SNAPSHOTS_EXTERNAL_ENABLED: 'false',

      GF_DATABASE_TYPE: 'postgres',
      GF_DATABASE_HOST: env.GRAFANA_DATABASE_HOST,
      GF_DATABASE_NAME: env.GRAFANA_DATABASE_NAME,
      GF_DATABASE_USER: env.GRAFANA_DATABASE_USER,
      GF_DATABASE_PASSWORD: env.GRAFANA_DATABASE_PASSWORD,
      GF_DATABASE_SSL_MODE: env.GRAFANA_DATABASE_SSL_MODE,
    };
  }

  override async onError(error: unknown): Promise<Response> {
    console.error('[grafana onError]', error instanceof Error ? error.message : String(error));
    throw error;
  }

  override async fetch(request: Request): Promise<Response> {
    await this.startAndWaitForPorts({
      ports: 3000,
      cancellationOptions: { portReadyTimeoutMS: 180_000 },
    });
    return this.containerFetch(request);
  }
}

/**
 * Landing/loading page shown when the Grafana container is not yet running.
 */
function landingPage(): Response {
  return new Response(
    `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Grafana · ProjectSites</title>
<meta name="description" content="Observability dashboards for ProjectSites — powered by Grafana.">
<meta name="color-scheme" content="dark">
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{min-height:100vh;background:#060610;color:#f4f4ff;font-family:'Space Grotesk',system-ui,sans-serif;line-height:1.6;display:flex;align-items:center;justify-content:center;padding:40px 20px;
  background-image:radial-gradient(60% 50% at 50% 0%,rgba(0,229,255,.10),transparent 70%)}
.wrap{max-width:640px;width:100%}
.status{display:inline-flex;align-items:center;gap:8px;font-family:'JetBrains Mono',monospace;font-size:.7rem;
  letter-spacing:.18em;text-transform:uppercase;color:#f59e0b;margin-bottom:18px}
.dot{width:8px;height:8px;border-radius:50%;background:#f59e0b;box-shadow:0 0 10px #f59e0b;animation:pulse 2s infinite}@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
.eyebrow{font-family:'JetBrains Mono',monospace;font-size:.7rem;letter-spacing:.22em;text-transform:uppercase;color:#00e5ff;margin-bottom:12px}
h1{font-size:clamp(1.8rem,5vw,2.8rem);font-weight:700;letter-spacing:-.03em;line-height:1.05;margin-bottom:14px;
  background:linear-gradient(135deg,#fff,rgba(0,229,255,.85));-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.sub{color:#94a3b8;font-size:1.05rem;margin-bottom:26px}
.card{background:linear-gradient(145deg,rgba(13,13,40,.55),rgba(8,8,32,.7));border:1px solid rgba(0,229,255,.12);
  border-radius:16px;padding:18px 20px;margin-bottom:14px}
.card h2{font-size:.7rem;font-family:'JetBrains Mono',monospace;letter-spacing:.1em;text-transform:uppercase;color:#94a3b8;margin-bottom:8px}
.card p{color:#cbd5e1;font-size:.95rem}.card code{color:#00e5ff;font-family:'JetBrains Mono',monospace;font-size:.82rem}
.host{font-family:'JetBrains Mono',monospace;color:#00e5ff;font-size:.82rem}
a{color:#00e5ff;text-decoration:none}a:hover{text-decoration:underline}
.foot{margin-top:24px;font-size:.82rem;color:#6b7785;text-align:center}
</style></head><body><div class="wrap">
<div class="status"><span class="dot"></span>Provisioning</div>
<div class="eyebrow">ProjectSites · Observability</div>
<h1>Grafana</h1>
<p class="sub">Observability dashboards for the ProjectSites platform — metrics, logs, health, and alerts. Powered by Grafana 12.</p>
<div class="card"><h2>Powered by</h2><p>Grafana 12.2.10 on Cloudflare Workers Containers with Neon Postgres backend. Stateless, version-controlled provisioning.</p></div>
<div class="card"><h2>Status</h2><p>The Grafana container is provisioning. This page will automatically serve the Grafana login page once the container is built and running.</p></div>
<p class="foot">&larr; <a href="https://projectsites.dev/">projectsites.dev</a> · <a href="https://grafana.com/">grafana.com</a></p>
</div></body></html>`,
    { status: 200, headers: { 'Content-Type': 'text/html;charset=utf-8', 'Cache-Control': 'public, max-age=60' } },
  );
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // /healthz → proxy to container's /api/health
    if (url.pathname === '/healthz') {
      try {
        const upstreamUrl = new URL(request.url);
        upstreamUrl.pathname = '/api/health';
        const upstream = await getContainer(env.GRAFANA, 'singleton').fetch(
          new Request(upstreamUrl, request),
        );
        return upstream;
      } catch {
        return new Response(JSON.stringify({ status: 'unhealthy', message: 'container not ready' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // Anonymous GET / → /login so the root returns a login page (200)
    const hasGrafanaSession =
      request.headers.get('Cookie')?.includes('grafana_session') ?? false;
    const isWebSocket = request.headers.get('Upgrade')?.toLowerCase() === 'websocket';

    if (request.method === 'GET' && url.pathname === '/' && !hasGrafanaSession && !isWebSocket) {
      url.pathname = '/login';
      const proxyReq = new Request(url, request);

      // Forward headers Grafana needs
      proxyReq.headers.set('X-Forwarded-Host', 'grafana.projectsites.dev');
      proxyReq.headers.set('X-Forwarded-Proto', 'https');
      proxyReq.headers.set('X-Real-IP', request.headers.get('CF-Connecting-IP') || '');

      try {
        const container = getContainer(env.GRAFANA, 'singleton');
        const upstream = await container.fetch(proxyReq);
        const resp = new Response(upstream.body, upstream);
        // Never cache authenticated pages
        if (resp.headers.get('Set-Cookie')?.includes('grafana_session')) {
          resp.headers.set('Cache-Control', 'private, no-cache, no-store, must-revalidate');
        }
        return resp;
      } catch {
        return landingPage();
      }
    }

    // All other requests: proxy normally
    try {
      const req = new Request(request);
      req.headers.set('X-Forwarded-Host', 'grafana.projectsites.dev');
      req.headers.set('X-Forwarded-Proto', 'https');
      req.headers.set('X-Real-IP', request.headers.get('CF-Connecting-IP') || '');

      const container = getContainer(env.GRAFANA, 'singleton');
      const upstream = await container.fetch(req);
      const resp = new Response(upstream.body, upstream);

      if (resp.headers.get('Set-Cookie')?.includes('grafana_session')) {
        resp.headers.set('Cache-Control', 'private, no-cache, no-store, must-revalidate');
      }
      return resp;
    } catch {
      return landingPage();
    }
  },
};
