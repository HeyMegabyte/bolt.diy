import { Container, getContainer } from '@cloudflare/containers';

/**
 * temporal.projectsites.dev — Temporal server on CF Workers Containers.
 *
 * Uses temporalio/auto-setup:1.22.4 with SKIP_SCHEMA_SETUP=true (schema
 * pre-initialized on Neon). Connects to Neon DIRECT endpoint (NOT pooler)
 * because Temporal uses prepared statements incompatible with PgBouncer.
 *
 * Env vars feed the auto-setup image's Go template config (config_template.yaml):
 *   DB=postgres12, POSTGRES_SEEDS, SQL_TLS_ENABLED=true, etc.
 */
interface Env {
  TEMPORAL: DurableObjectNamespace<Temporal>;
  POSTGRES_SEEDS: string;
  POSTGRES_USER: string;
  POSTGRES_PWD: string;
}

export class Temporal extends Container<Env> {
  override defaultPort = 7233;
  override sleepAfter = '30m';

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.envVars = {
      DB: 'postgres12',
      DB_PORT: '5432',
      DBNAME: 'projectsites_temporal',
      VISIBILITY_DBNAME: 'projectsites_temporal_visibility',
      POSTGRES_SEEDS: env.POSTGRES_SEEDS,
      POSTGRES_USER: env.POSTGRES_USER,
      POSTGRES_PWD: env.POSTGRES_PWD,
      SQL_TLS_ENABLED: 'true',
      SQL_HOST_VERIFICATION: 'false',
      SKIP_SCHEMA_SETUP: 'true',
      SKIP_DEFAULT_NAMESPACE_CREATION: 'true',
      BIND_ON_IP: '0.0.0.0',
      TEMPORAL_BROADCAST_ADDRESS: '127.0.0.1',
    };
  }

  async fetch(request: Request): Promise<Response> {
    await this.startAndWaitForPorts({
      ports: 7233,
      cancellationOptions: { portReadyTimeoutMS: 180_000, instanceGetTimeoutMS: 30_000 },
    });
    return this.containerFetch(request);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return getContainer(env.TEMPORAL, 'singleton').fetch(request);
  },
};
