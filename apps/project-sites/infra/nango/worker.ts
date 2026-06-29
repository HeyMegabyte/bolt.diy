import { Container, getContainer } from '@cloudflare/containers';

/**
 * integrations.projectsites.dev — Nango (unified OAuth/integrations) on CF
 * Workers Containers. Stateless container; data in Neon Postgres + Upstash Redis.
 * Self-hosted OSS image (nangohq/nango-server:hosted). Server on :8080.
 *
 * Pattern mirrors infra/listmonk: extend Container, override fetch() to call
 * startAndWaitForPorts() before containerFetch(), and export a thin default
 * handler that delegates to the DO.
 */
interface Env {
  NANGO_CONTAINER: DurableObjectNamespace<Nango>;
  NANGO_DATABASE_URL: string;
  NANGO_ENCRYPTION_KEY: string;
  NANGO_REDIS_URL: string;
  NANGO_DB_SSL?: string;
  FLAG_SERVE_CONNECT_UI?: string;
  NANGO_PUBLIC_CONNECT_URL?: string;
  NANGO_DASHBOARD_PASSWORD?: string;
  STRIPE_PUBLISHABLE_KEY?: string;
}

export class Nango extends Container<Env> {
  defaultPort = 8080;
  sleepAfter = '15m';

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.envVars = {
      NANGO_DATABASE_URL: env.NANGO_DATABASE_URL,
      NANGO_ENCRYPTION_KEY: env.NANGO_ENCRYPTION_KEY,
      NANGO_REDIS_URL: env.NANGO_REDIS_URL,
      NANGO_SERVER_URL: 'https://integrations.projectsites.dev',
      SERVER_PORT: '8080',
      NANGO_DB_SSL: env.NANGO_DB_SSL ?? 'true',
      NODE_ENV: 'production',
      TELEMETRY: 'false',
      FLAG_AUTH_ENABLED: 'false',
      FLAG_SERVE_CONNECT_UI: env.FLAG_SERVE_CONNECT_UI ?? 'true',
      NANGO_PUBLIC_CONNECT_URL: env.NANGO_PUBLIC_CONNECT_URL ?? 'https://integrations.projectsites.dev',
      STRIPE_PUBLISHABLE_KEY: env.STRIPE_PUBLISHABLE_KEY ?? '',
      NANGO_DASHBOARD_USERNAME: 'admin',
      NANGO_DASHBOARD_PASSWORD: this._resolveDashPass(env),
    };
  }

  /** Start the container + wait for port 8080, then proxy the request. */
  async fetch(request: Request): Promise<Response> {
    await this.startAndWaitForPorts({
      ports: 8080,
      cancellationOptions: { portReadyTimeoutMS: 90_000 },
    });
    return this.containerFetch(request);
  }

  private _resolveDashPass(env: Env & {NANGO_DASHBOARD_PASSWORD?: string}): string {
    if (env.NANGO_DASHBOARD_PASSWORD) return env.NANGO_DASHBOARD_PASSWORD;
    const rand = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(rand, b => b.toString(16).padStart(2, '0')).join('');
  }
}

function landingPage(): Response {
  return new Response(
    `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Integrations · ProjectSites</title>
<meta name="description" content="OAuth connection hub for ProjectSites — third-party integrations powered by Nango.">
<meta name="color-scheme" content="dark">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{min-height:100vh;background:#060610;color:#f4f4ff;font-family:system-ui,sans-serif;line-height:1.6;display:flex;align-items:center;justify-content:center;padding:40px 20px;
  background-image:radial-gradient(60% 50% at 50% 0%,rgba(0,229,255,.10),transparent 70%)}
.status{display:inline-flex;align-items:center;gap:8px;font-family:monospace;font-size:.7rem;
  letter-spacing:.18em;text-transform:uppercase;color:#f59e0b;margin-bottom:18px}
.dot{width:8px;height:8px;border-radius:50%;background:#f59e0b;box-shadow:0 0 10px #f59e0b;animation:pulse 2s infinite}@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
a{color:#00e5ff;text-decoration:none}
</style></head><body><div class="wrap">
<div class="status"><span class="dot"></span>Provisioning</div>
<h1>Integrations</h1>
<p>The Nango container is starting. Dashboard will load automatically once ready.</p>
</div></body></html>`,
    { status: 200, headers: { 'Content-Type': 'text/html;charset=utf-8', 'Cache-Control': 'public, max-age=60' } },
  );
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (!env.NANGO_CONTAINER) return landingPage();
    const container = getContainer(env.NANGO_CONTAINER, 'singleton');
    return container.fetch(request);
  },
};
