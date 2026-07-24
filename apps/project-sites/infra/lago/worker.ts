import { Container, getContainer } from '@cloudflare/containers';

/**
 * lago.projectsites.dev — Lago billing on CF Containers.
 *
 * Previously hosted on Fly.io. Moved to CF Containers for lower latency
 * (same edge network as all other platform infra) and native D1/KV/R2 integration.
 *
 * Backends: Neon Postgres (projectsites_lago), ClickHouse (ch.projectsites.dev for analytics).
 */
interface Env {
  LAGO: DurableObjectNamespace<Lago>;
  DATABASE_URL: string;
  SECRET_KEY_BASE: string;
  REDIS_URL: string;
  LAGO_CLICKHOUSE_URL?: string;
  LAGO_CLICKHOUSE_DATABASE?: string;
  LAGO_CLICKHOUSE_USERNAME?: string;
  LAGO_CLICKHOUSE_PASSWORD?: string;
  LAGO_FRONT_URL?: string;
}

export class Lago extends Container<Env> {
  override defaultPort = 3000;
  override sleepAfter = '15m';

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const out: Record<string, string> = {
      RAILS_ENV: 'production',
      PORT: '3000',
      DATABASE_URL: env.DATABASE_URL,
      SECRET_KEY_BASE: env.SECRET_KEY_BASE,
      REDIS_URL: env.REDIS_URL,
      LAGO_FRONT_URL: env.LAGO_FRONT_URL || 'https://lago.projectsites.dev',
      RAILS_LOG_TO_STDOUT: 'true',
      RAILS_SERVE_STATIC_FILES: 'false',
    };
    if (env.LAGO_CLICKHOUSE_URL) {
      out.LAGO_CLICKHOUSE_URL = env.LAGO_CLICKHOUSE_URL;
      out.LAGO_CLICKHOUSE_DATABASE = env.LAGO_CLICKHOUSE_DATABASE || 'lago';
      out.LAGO_CLICKHOUSE_USERNAME = env.LAGO_CLICKHOUSE_USERNAME || 'dittofeed';
      if (env.LAGO_CLICKHOUSE_PASSWORD) out.LAGO_CLICKHOUSE_PASSWORD = env.LAGO_CLICKHOUSE_PASSWORD;
    }
    this.envVars = out;
  }

  override async fetch(request: Request): Promise<Response> {
    await this.startAndWaitForPorts({
      ports: 3000,
      cancellationOptions: { portReadyTimeoutMS: 180_000 },
    });
    return this.containerFetch(request);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return getContainer(env.LAGO, 'singleton').fetch(request);
  },
};
