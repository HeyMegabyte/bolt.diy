import { Container, getContainer } from '@cloudflare/containers';

/**
 * crm.projectsites.dev — Twenty CRM on CF Workers Containers.
 *
 * @remarks
 * Twenty runs as a CF Container (port 3000); its schema + data live in Neon Postgres
 * and its BullMQ message queue uses Upstash Redis (CF Containers have no persistent
 * volume), so the container is stateless + hibernates after idle. The upstream image's
 * entrypoint runs DB migrations on first boot (DISABLE_DB_MIGRATIONS unset), so the
 * first cold-start self-migrates the Neon DB before serving.
 *
 * Deploy: `wrangler deploy` (builds the Dockerfile container image — needs Docker).
 * Reachable at https://crm.projectsites.dev (custom_domain route in wrangler.toml).
 */
interface Env {
  TWENTY: DurableObjectNamespace<TwentyCrm>;
  /** Neon Postgres connection string (postgresql://...sslmode=require). */
  PG_DATABASE_URL: string;
  /** Upstash Redis URL (rediss://default:<pw>@<host>:6379) — BullMQ queue + cache. */
  REDIS_URL: string;
  /** Signs sessions/tokens (openssl rand -base64 32). */
  APP_SECRET: string;
}

export class TwentyCrm extends Container<Env> {
  override defaultPort = 3000;
  // Twenty's first boot runs migrations; give it room and hibernate after idle.
  override sleepAfter = '30m';

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.envVars = {
      // Public URL Twenty mints links/redirects against (server + bundled frontend).
      SERVER_URL: 'https://crm.projectsites.dev',
      FRONTEND_URL: 'https://crm.projectsites.dev',
      PORT: '3000',
      NODE_PORT: '3000',
      PG_DATABASE_URL: env.PG_DATABASE_URL,
      REDIS_URL: env.REDIS_URL,
      APP_SECRET: env.APP_SECRET,
      // No persistent volume on CF Containers → keep uploads in Postgres-backed local
      // storage (ephemeral) rather than a disk that vanishes on hibernation.
      STORAGE_TYPE: 'local',
      // BullMQ queue over Upstash Redis. The Dockerfile CMD now runs the Twenty worker
      // (`node dist/queue-worker/queue-worker`) in-process alongside the server, so async
      // jobs (workspace activation/metadata-sync, signing-key rotation, email) are drained.
      // (sync-mode was tried first but didn't run the workspace-init job; a real worker does.)
      MESSAGE_QUEUE_TYPE: 'bull-mq',
      // SINGLE-workspace mode (multiworkspace OFF): the whole CRM lives on the base
      // host crm.projectsites.dev. Multiworkspace would redirect to per-workspace
      // subdomains (app.crm.projectsites.dev / <ws>.crm.projectsites.dev) which need
      // wildcard DNS + cert we don't provision → chrome-error on signup. On a clean
      // schema + warm Neon, the FIRST signup creates the default workspace inline under
      // the sync queue. (Diagnosed 2026-06-27 — crm single-host signup repair.)
      IS_MULTIWORKSPACE_ENABLED: 'false',
      // Run migrations on boot (entrypoint reads this; "true" would skip them).
      DISABLE_DB_MIGRATIONS: 'false',
      DISABLE_CRON_JOBS_REGISTRATION: 'false',
      TZ: 'America/New_York',
    };
  }

  override async fetch(request: Request): Promise<Response> {
    // First cold-start runs migrations + boots Nest — allow a generous window.
    await this.startAndWaitForPorts({
      ports: 3000,
      cancellationOptions: { portReadyTimeoutMS: 230_000, instanceGetTimeoutMS: 30_000 },
    });
    return this.containerFetch(request);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return getContainer(env.TWENTY, 'singleton').fetch(request);
  },
};
