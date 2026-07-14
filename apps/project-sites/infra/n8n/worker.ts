import { Container, getContainer } from '@cloudflare/containers';

/**
 * automations.projectsites.dev — n8n workflow automation on CF Workers Containers.
 *
 * n8n web/editor runs as a CF Container (port 5678).
 * The worker process runs separately on Fly.io.
 * Backing services: Neon Postgres + Upstash Redis.
 */
interface Env {
  N8N: DurableObjectNamespace<N8nContainerDO>;
  // Secrets forwarded into the container
  DB_POSTGRESDB_HOST: string;
  DB_POSTGRESDB_USER: string;
  DB_POSTGRESDB_PASSWORD: string;
  QUEUE_BULL_REDIS_HOST: string;
  QUEUE_BULL_REDIS_PASSWORD: string;
  N8N_ENCRYPTION_KEY: string;
  N8N_SENTRY_DSN: string;
}

export class N8nContainerDO extends Container<Env> {
  override defaultPort = 5678;
  override sleepAfter = '30m';

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.envVars = {
      // Public URL
      N8N_HOST: 'automations.projectsites.dev',
      N8N_PROTOCOL: 'https',
      N8N_PORT: '5678',
      WEBHOOK_URL: 'https://automations.projectsites.dev/',
      N8N_EDITOR_BASE_URL: 'https://automations.projectsites.dev/',
      N8N_PROXY_HOPS: '1',

      // Runtime
      NODE_ENV: 'production',
      GENERIC_TIMEZONE: 'America/New_York',
      TZ: 'America/New_York',
      N8N_ENCRYPTION_KEY: env.N8N_ENCRYPTION_KEY,

      // Database — Neon
      DB_TYPE: 'postgresdb',
      DB_POSTGRESDB_HOST: env.DB_POSTGRESDB_HOST,
      DB_POSTGRESDB_PORT: '5432',
      DB_POSTGRESDB_DATABASE: 'n8n',
      DB_POSTGRESDB_USER: env.DB_POSTGRESDB_USER,
      DB_POSTGRESDB_PASSWORD: env.DB_POSTGRESDB_PASSWORD,
      DB_POSTGRESDB_SSL_ENABLED: 'true',

      // Queue mode — Upstash Redis
      EXECUTIONS_MODE: 'queue',
      QUEUE_BULL_REDIS_HOST: env.QUEUE_BULL_REDIS_HOST,
      QUEUE_BULL_REDIS_PORT: '6379',
      QUEUE_BULL_REDIS_PASSWORD: env.QUEUE_BULL_REDIS_PASSWORD,
      QUEUE_BULL_REDIS_TLS: 'true',

      // Health / metrics
      N8N_METRICS: 'true',
      QUEUE_HEALTH_CHECK_ACTIVE: 'true',

      // Privacy
      N8N_DIAGNOSTICS_ENABLED: 'false',
      N8N_VERSION_NOTIFICATIONS_ENABLED: 'false',
      N8N_TEMPLATES_ENABLED: 'false',

      // Binary data safety
      N8N_DEFAULT_BINARY_DATA_MODE: 'database',

      // Execution retention / safety
      EXECUTIONS_DATA_PRUNE: 'true',
      EXECUTIONS_DATA_MAX_AGE: '336',
      EXECUTIONS_TIMEOUT: '300',
      EXECUTIONS_TIMEOUT_MAX: '3600',
      N8N_CONCURRENCY_PRODUCTION_LIMIT: '25',

      // Community nodes — curated allowlist
      N8N_COMMUNITY_PACKAGES_ENABLED: 'true',
      N8N_COMMUNITY_PACKAGES_ALLOWLIST: 'n8n-nodes-slack,n8n-nodes-discord,n8n-nodes-telegram,n8n-nodes-google-sheets,n8n-nodes-airtable,n8n-nodes-notion',

      // Rate limiting for webhook endpoints
      N8N_RATE_LIMITER_ENABLED: 'true',
      N8N_RATE_LIMIT_MAX: '30',
      N8N_RATE_LIMIT_WINDOW_MS: '60000',

      // Sentry error tracking (shared with main ProjectSites worker)
      N8N_SENTRY_DSN: env.N8N_SENTRY_DSN,
    };
  }

  override async fetch(request: Request): Promise<Response> {
    await this.startAndWaitForPorts({
      ports: 5678,
      cancellationOptions: { portReadyTimeoutMS: 180_000, instanceGetTimeoutMS: 30_000 },
    });
    return this.containerFetch(request);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (!env.N8N) {
      return new Response(
        '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="color-scheme" content="dark"><title>Automations · ProjectSites</title><style>body{min-height:100vh;background:#060610;color:#f4f4ff;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center}div{text-align:center}h1{font-size:2rem;margin-bottom:.5rem}p{color:#94a3b8}a{color:#00e5ff}</style></head><body><div><h1>Automations</h1><p>Workflow engine is provisioning.</p></div></body></html>',
        { status: 200, headers: { 'Content-Type': 'text/html;charset=utf-8' } },
      );
    }
    const container = getContainer(env.N8N, 'singleton');
    return container.fetch(request);
  },
};
