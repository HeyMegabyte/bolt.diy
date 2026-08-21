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
  /**
   * Twenty AI provider catalog (JSON, deep-merged onto Twenty's built-in catalog).
   * Holds a custom `@ai-sdk/openai-compatible` provider pointing at the ProjectSites
   * LiteLLM gateway (llm.megabyte.space) so Twenty's AI uses the platform LLM facade
   * (cost/quality model routing + CF AI Gateway caching) instead of a raw vendor key.
   * Value carries the LiteLLM master key → set as a wrangler secret. Optional: unset
   * = Twenty falls back to its built-in OPENAI/ANTHROPIC/XAI key detection.
   */
  AI_PROVIDERS?: string;
  /** Google OAuth client ID (Google Cloud Console) — enables Google SSO when set. */
  AUTH_GOOGLE_CLIENT_ID?: string;
  /** Google OAuth client secret (Google Cloud Console). */
  AUTH_GOOGLE_CLIENT_SECRET?: string;
}

export class TwentyCrm extends Container<Env> {
  override defaultPort = 3000;
  // Twenty's first boot runs migrations; give it room and hibernate after idle.
  override sleepAfter = '15m'; // scale-to-zero 2026-08-20

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
      // Email+password login enabled.
      AUTH_PASSWORD_ENABLED: 'true',
      // No public self-signup — only existing members + explicitly invited users can
      // authenticate. (Brian 2026-06-27: "no public sign up". Note: IS_SIGN_UP_DISABLED
      // must be 'true' to DISABLE signup — 'false' would leave it open.)
      IS_SIGN_UP_DISABLED: 'true',
      // Google SSO auto-activates once the OAuth secrets are set, so deploying before the
      // creds land doesn't render a broken Google button. Register this callback URL in
      // Google Cloud Console: https://crm.projectsites.dev/auth/google/redirect
      AUTH_GOOGLE_ENABLED: env.AUTH_GOOGLE_CLIENT_ID ? 'true' : 'false',
      AUTH_GOOGLE_CLIENT_ID: env.AUTH_GOOGLE_CLIENT_ID ?? '',
      AUTH_GOOGLE_CLIENT_SECRET: env.AUTH_GOOGLE_CLIENT_SECRET ?? '',
      AUTH_GOOGLE_CALLBACK_URL: 'https://crm.projectsites.dev/auth/google/redirect',
      // Connected accounts (Gmail thread + Google Calendar sync into the CRM) — a SEPARATE
      // OAuth flow from SSO login, reusing the same Google client. Surfaces the "connect
      // account" UI only when the OAuth client exists. Requires, in Google Cloud Console:
      // Gmail API + Calendar API enabled, the gmail/calendar scopes consented, and this
      // APIs callback registered as an authorized redirect URI (distinct from the SSO one).
      // Sync jobs run on the in-container worker (MESSAGE_QUEUE_TYPE=bull-mq, already set).
      ...(env.AUTH_GOOGLE_CLIENT_ID
        ? {
            MESSAGING_PROVIDER_GMAIL_ENABLED: 'true',
            CALENDAR_PROVIDER_GOOGLE_ENABLED: 'true',
            AUTH_GOOGLE_APIS_CALLBACK_URL:
              'https://crm.projectsites.dev/auth/google-apis/get-access-token',
          }
        : {}),
      // Route Twenty's AI through the ProjectSites LiteLLM gateway (llm.megabyte.space)
      // via a custom @ai-sdk/openai-compatible provider. Only injected when the secret
      // is set; otherwise Twenty uses its built-in vendor-key detection.
      ...(env.AI_PROVIDERS ? { AI_PROVIDERS: env.AI_PROVIDERS } : {}),
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
