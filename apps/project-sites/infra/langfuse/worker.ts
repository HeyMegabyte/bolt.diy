import { Container, getContainer } from '@cloudflare/containers';

/**
 * traces.projectsites.dev — Langfuse v3 web (LLM observability) on CF Containers.
 *
 * @remarks
 * Langfuse v3 web runs as a Next.js CF Container (port 3000). Backends:
 *   Postgres → Neon (projectsites_langfuse) · ClickHouse → Fly (projectsites-clickhouse)
 *   Redis → Upstash · S3 blobs → R2 (projectsites-langfuse bucket).
 * First boot runs PG + ClickHouse migrations then serves the login (/auth/sign-in → 200).
 * Reachable via an EXPLICIT Workers route (the *.projectsites.dev/* wildcard would shadow
 * it). Non-secret config is set inline; creds arrive as wrangler secrets via env.
 */
interface Env {
  LANGFUSE: DurableObjectNamespace<Langfuse>;
  /** Neon Postgres (postgresql://...?sslmode=require — Prisma/standard, not asyncpg). */
  DATABASE_URL: string;
  /** ClickHouse (Fly) password for the `langfuse` user. */
  CLICKHOUSE_PASSWORD: string;
  /** Upstash Redis (rediss://default:<pw>@<host>:6379) — event queue + cache. */
  REDIS_CONNECTION_STRING: string;
  /** R2 S3 access key id + secret (LANGFUSE_S3_EVENT_UPLOAD_*). */
  S3_ACCESS_KEY_ID: string;
  S3_SECRET_ACCESS_KEY: string;
  /** NextAuth session secret. */
  NEXTAUTH_SECRET: string;
  /** Salt for hashing API keys. */
  SALT: string;
  /** AES-256 key (64 hex) for at-rest encryption of integration creds. */
  ENCRYPTION_KEY: string;
  /** SES SMTP connection URL (smtp://user:pass@email-smtp...:587) — enables Langfuse
   *  email: invites, password reset, batch-export-ready + eval-alert notifications. */
  SMTP_CONNECTION_URL?: string;
}

const ACCOUNT_ID = '84fa0d1b16ff8086dd958c468ce7fd59';
const CH_HOST = 'projectsites-clickhouse.fly.dev';

export class Langfuse extends Container<Env> {
  override defaultPort = 3000;
  override sleepAfter = '30m';

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const pairs: Record<string, string | undefined> = {
      // ── secrets (wrangler) ──
      DATABASE_URL: env.DATABASE_URL,
      CLICKHOUSE_PASSWORD: env.CLICKHOUSE_PASSWORD,
      REDIS_CONNECTION_STRING: env.REDIS_CONNECTION_STRING,
      LANGFUSE_S3_EVENT_UPLOAD_ACCESS_KEY_ID: env.S3_ACCESS_KEY_ID,
      LANGFUSE_S3_EVENT_UPLOAD_SECRET_ACCESS_KEY: env.S3_SECRET_ACCESS_KEY,
      NEXTAUTH_SECRET: env.NEXTAUTH_SECRET,
      SALT: env.SALT,
      ENCRYPTION_KEY: env.ENCRYPTION_KEY,
      SMTP_CONNECTION_URL: env.SMTP_CONNECTION_URL,
    };
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(pairs)) {
      if (typeof v === 'string' && v.length > 0) out[k] = v;
    }
    // ── non-secret config ──
    out.CLICKHOUSE_URL = `http://${CH_HOST}:8123`;
    out.CLICKHOUSE_MIGRATION_URL = `clickhouse://${CH_HOST}:9000`;
    out.CLICKHOUSE_USER = 'langfuse';
    out.CLICKHOUSE_CLUSTER_ENABLED = 'false';
    // ── R2 (S3-compatible) blob storage — all three Langfuse v3 blob purposes on ONE
    // R2 bucket (`projectsites-langfuse`), namespaced by prefix, sharing the same R2 S3
    // API token (S3_ACCESS_KEY_ID/SECRET). R2 needs region=auto + force-path-style=true.
    const R2_ENDPOINT = `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`;
    const R2_BUCKET = 'projectsites-langfuse';
    // 1) Event uploads (raw ingestion events — REQUIRED in v3).
    out.LANGFUSE_S3_EVENT_UPLOAD_BUCKET = R2_BUCKET;
    out.LANGFUSE_S3_EVENT_UPLOAD_ENDPOINT = R2_ENDPOINT;
    out.LANGFUSE_S3_EVENT_UPLOAD_REGION = 'auto';
    out.LANGFUSE_S3_EVENT_UPLOAD_FORCE_PATH_STYLE = 'true';
    out.LANGFUSE_S3_EVENT_UPLOAD_PREFIX = 'events/';
    // 2) Media uploads (multimodal trace attachments) + 3) Batch exports (CSV/JSON → R2).
    // Both reuse the same R2 bucket + the event-upload R2 credentials. Only wired when the
    // R2 S3 creds are present (v3 requires them for event uploads anyway), so we never ship
    // an enabled batch-export with empty creds.
    if (env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY) {
      out.LANGFUSE_S3_MEDIA_UPLOAD_BUCKET = R2_BUCKET;
      out.LANGFUSE_S3_MEDIA_UPLOAD_ENDPOINT = R2_ENDPOINT;
      out.LANGFUSE_S3_MEDIA_UPLOAD_REGION = 'auto';
      out.LANGFUSE_S3_MEDIA_UPLOAD_FORCE_PATH_STYLE = 'true';
      out.LANGFUSE_S3_MEDIA_UPLOAD_PREFIX = 'media/';
      out.LANGFUSE_S3_MEDIA_UPLOAD_ACCESS_KEY_ID = env.S3_ACCESS_KEY_ID;
      out.LANGFUSE_S3_MEDIA_UPLOAD_SECRET_ACCESS_KEY = env.S3_SECRET_ACCESS_KEY;

      out.LANGFUSE_S3_BATCH_EXPORT_ENABLED = 'true';
      out.LANGFUSE_S3_BATCH_EXPORT_BUCKET = R2_BUCKET;
      out.LANGFUSE_S3_BATCH_EXPORT_ENDPOINT = R2_ENDPOINT;
      out.LANGFUSE_S3_BATCH_EXPORT_REGION = 'auto';
      out.LANGFUSE_S3_BATCH_EXPORT_FORCE_PATH_STYLE = 'true';
      out.LANGFUSE_S3_BATCH_EXPORT_PREFIX = 'exports/';
      out.LANGFUSE_S3_BATCH_EXPORT_ACCESS_KEY_ID = env.S3_ACCESS_KEY_ID;
      out.LANGFUSE_S3_BATCH_EXPORT_SECRET_ACCESS_KEY = env.S3_SECRET_ACCESS_KEY;
    }
    out.NEXTAUTH_URL = 'https://traces.projectsites.dev';
    out.TELEMETRY_ENABLED = 'false';
    out.HOSTNAME = '0.0.0.0';
    // ── hardening / product config ──
    // Private instance: no public self-signup (you + invited members only). The UI is
    // ALSO behind CF Access, so this is defense-in-depth.
    out.AUTH_DISABLE_SIGNUP = 'true';
    // Enforce HTTPS in the Content-Security-Policy (served behind the CF edge anyway).
    out.LANGFUSE_CSP_ENFORCE_HTTPS = 'true';
    // Quieter logs (default is info — noisy for a single-tenant instance).
    out.LANGFUSE_LOG_LEVEL = 'warn';
    // SES email "from" (projectsites.dev is a verified SES identity). Only takes effect
    // when SMTP_CONNECTION_URL is set above.
    if (out.SMTP_CONNECTION_URL) out.EMAIL_FROM_ADDRESS = 'noreply@projectsites.dev';
    this.envVars = out;
  }

  override async fetch(request: Request): Promise<Response> {
    await this.startAndWaitForPorts({
      ports: 3000,
      // First boot runs PG + ClickHouse migrations — generous window.
      cancellationOptions: { portReadyTimeoutMS: 220_000 },
    });
    return this.containerFetch(request);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return getContainer(env.LANGFUSE, 'singleton').fetch(request);
  },
};
