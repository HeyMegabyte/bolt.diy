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
    out.LANGFUSE_S3_EVENT_UPLOAD_BUCKET = 'projectsites-langfuse';
    out.LANGFUSE_S3_EVENT_UPLOAD_ENDPOINT = `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`;
    out.LANGFUSE_S3_EVENT_UPLOAD_REGION = 'auto';
    out.LANGFUSE_S3_EVENT_UPLOAD_FORCE_PATH_STYLE = 'true';
    out.NEXTAUTH_URL = 'https://traces.projectsites.dev';
    out.TELEMETRY_ENABLED = 'false';
    out.HOSTNAME = '0.0.0.0';
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
