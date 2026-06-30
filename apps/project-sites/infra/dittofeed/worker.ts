import { Container, getContainer } from '@cloudflare/containers';

/**
 * engage.projectsites.dev — Dittofeed customer engagement platform on CF Workers Containers.
 *
 * Dittofeed lite (API + dashboard + worker) on port 3000.
 * Neon Postgres for metadata. Fly.io ClickHouse for events.
 * Deploy 2026-06-29 — v3, matching Nango pattern.
 */
interface Env {
  DITTOFEED: DurableObjectNamespace<Dittofeed>;
  DATABASE_HOST: string;
  DATABASE_PORT: string;
  DATABASE_USER: string;
  DATABASE_PASSWORD: string;
  DATABASE_NAME: string;
  SECRET_KEY: string;
  PASSWORD: string;
  CLICKHOUSE_HOST: string;
  CLICKHOUSE_USER: string;
  CLICKHOUSE_PASSWORD: string;
}

export class Dittofeed extends Container<Env> {
  override defaultPort = 3000;
  override sleepAfter = '15m';

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.envVars = {
      NODE_ENV: 'production',
      DATABASE_HOST: env.DATABASE_HOST,
      DATABASE_PORT: env.DATABASE_PORT || '5432',
      DATABASE_USER: env.DATABASE_USER,
      DATABASE_PASSWORD: env.DATABASE_PASSWORD,
      DATABASE_NAME: env.DATABASE_NAME,
      CLICKHOUSE_HOST: env.CLICKHOUSE_HOST,
      CLICKHOUSE_USER: env.CLICKHOUSE_USER,
      CLICKHOUSE_PASSWORD: env.CLICKHOUSE_PASSWORD,
      TEMPORAL_ADDRESS: 'localhost:7233',
      SECRET_KEY: env.SECRET_KEY,
      PASSWORD: env.PASSWORD,
      AUTH_MODE: 'single-tenant',
      WORKSPACE_NAME: 'ProjectSites',
      BOOTSTRAP: 'true',
      DASHBOARD_API_BASE: 'https://engage.projectsites.dev',
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
    if (!env.DITTOFEED) {
      return new Response(
        '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="color-scheme" content="dark"><title>Engage · ProjectSites</title><style>body{min-height:100vh;background:#060610;color:#f4f4ff;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center}div{text-align:center}h1{font-size:2rem;margin-bottom:.5rem}p{color:#94a3b8}a{color:#00e5ff}</style></head><body><div><h1>Engage</h1><p>Customer engagement is provisioning.</p></div></body></html>',
        { status: 200, headers: { 'Content-Type': 'text/html;charset=utf-8' } },
      );
    }
    const container = getContainer(env.DITTOFEED, 'singleton');
    return container.fetch(request);
  },
};
