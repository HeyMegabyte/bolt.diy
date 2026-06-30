import { Container, getContainer } from '@cloudflare/containers';

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

  async fetch(request: Request): Promise<Response> {
    await this.startAndWaitForPorts({
      ports: 8080,
      cancellationOptions: { portReadyTimeoutMS: 120_000 },
    });
    return this.containerFetch(request);
  }

  private _resolveDashPass(env: Env & {NANGO_DASHBOARD_PASSWORD?: string}): string {
    if (env.NANGO_DASHBOARD_PASSWORD) return env.NANGO_DASHBOARD_PASSWORD;
    const rand = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(rand, b => b.toString(16).padStart(2, '0')).join('');
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (!env.NANGO_CONTAINER) {
      return new Response(
        `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="color-scheme" content="dark"><title>Integrations · ProjectSites</title>
<style>body{min-height:100vh;background:#060610;color:#f4f4ff;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center}div{text-align:center}h1{font-size:2rem;margin-bottom:.5rem}p{color:#94a3b8}a{color:#00e5ff}
</style></head><body><div><h1>Integrations</h1><p>Nango container is provisioning.</p></div></body></html>`,
        { status: 200, headers: { 'Content-Type': 'text/html;charset=utf-8' } },
      );
    }
    const container = getContainer(env.NANGO_CONTAINER, 'singleton');
    return container.fetch(request);
  },
};
