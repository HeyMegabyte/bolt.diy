import { Container, getContainer } from '@cloudflare/containers';

/**
 * deepcrawl.projectsites.dev — Deepcrawl website data extraction platform on CF Workers Containers.
 *
 * Dashboard (Next.js 16) on port 3000.
 * API Worker (v0) at api.deepcrawl.projectsites.dev.
 * Auth Worker (better-auth) at auth.deepcrawl.projectsites.dev.
 * D1 for API data. Neon Postgres for auth sessions.
 * Deploy 2026-06-30.
 */
interface Env {
  DEEPCRAWL_DASHBOARD: DurableObjectNamespace<DeepcrawlDashboard>;
  NEXT_PUBLIC_APP_URL: string;
  NEXT_PUBLIC_DEEPCRAWL_API_URL: string;
  BETTER_AUTH_URL: string;
  AUTH_COOKIE_DOMAIN: string;
  AUTH_MODE: string;
  BETTER_AUTH_SECRET: string;
  DATABASE_URL: string;
  NEXT_PUBLIC_BRAND_NAME: string;
}

export class DeepcrawlDashboard extends Container<Env> {
  override defaultPort = 3000;
  override sleepAfter = '30m';

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.envVars = {
      NODE_ENV: 'production',
      NEXT_PUBLIC_APP_URL: env.NEXT_PUBLIC_APP_URL,
      NEXT_PUBLIC_DEEPCRAWL_API_URL: env.NEXT_PUBLIC_DEEPCRAWL_API_URL,
      NEXT_PUBLIC_BETTER_AUTH_URL: env.BETTER_AUTH_URL,
      BETTER_AUTH_URL: env.BETTER_AUTH_URL,
      AUTH_COOKIE_DOMAIN: env.AUTH_COOKIE_DOMAIN,
      AUTH_MODE: env.AUTH_MODE || 'better-auth',
      BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET,
      DATABASE_URL: env.DATABASE_URL,
      NEXT_PUBLIC_BRAND_NAME: env.NEXT_PUBLIC_BRAND_NAME || 'Deepcrawl',
      NEXT_PUBLIC_USE_AUTH_WORKER: 'true',
      PORT: '3000',
    };
  }

  async fetch(request: Request): Promise<Response> {
    await this.startAndWaitForPorts({
      ports: 3000,
      cancellationOptions: { portReadyTimeoutMS: 240_000, instanceGetTimeoutMS: 30_000 },
    });
    return this.containerFetch(request);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (!env.DEEPCRAWL_DASHBOARD) {
      return new Response(
        '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="color-scheme" content="dark"><title>Deepcrawl · ProjectSites</title><style>body{min-height:100vh;background:#060610;color:#f4f4ff;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center}div{text-align:center}h1{font-size:2rem;margin-bottom:.5rem}p{color:#94a3b8}a{color:#00e5ff}</style></head><body><div><h1>Deepcrawl</h1><p>Website data extraction is provisioning.</p></div></body></html>',
        { status: 200, headers: { 'Content-Type': 'text/html;charset=utf-8' } },
      );
    }
    const container = getContainer(env.DEEPCRAWL_DASHBOARD, 'singleton');
    return container.fetch(request);
  },
};
