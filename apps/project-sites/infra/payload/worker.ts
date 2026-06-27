import { Container, getContainer } from '@cloudflare/containers';

/**
 * cms.projectsites.dev — Payload CMS (Next.js standalone) on CF Workers Containers.
 *
 * @remarks
 * Payload runs as a CF Container (Next standalone server on port 3000). Its schema +
 * content live in Neon Postgres (CF Containers have no persistent volume), and the
 * postgres adapter is configured with `push: true`, so the first cold-start auto-syncs
 * the schema (creates tables) before serving — no separate migration step.
 *
 * Deploy: `wrangler deploy` (builds ./app/Dockerfile — needs Docker).
 * Reachable at https://cms.projectsites.dev (custom_domain route in wrangler.toml).
 * Admin UI at /admin; the public frontend at /.
 */
interface Env {
  PAYLOAD: DurableObjectNamespace<PayloadCms>;
  /** Neon Postgres connection string (postgresql://...sslmode=require). */
  DATABASE_URI: string;
  /** Signs Payload auth tokens (openssl rand -base64 32). */
  PAYLOAD_SECRET: string;
  /** R2 (S3-compatible) media storage — uploads persist here, not on ephemeral disk. */
  S3_ENDPOINT?: string;
  S3_BUCKET?: string;
  S3_ACCESS_KEY_ID?: string;
  S3_SECRET_ACCESS_KEY?: string;
  /** Resend — transactional email (password reset / verification / invites). */
  RESEND_API_KEY?: string;
  /** OpenAI — AI auto-excerpt on publish (inert when unset). */
  OPENAI_API_KEY?: string;
  /** Shared secret letting an external cron trigger POST /api/db-backup. */
  BACKUP_SECRET?: string;
  /** Platform endpoint notified on publish so generated sites revalidate (#6). */
  SITES_REVALIDATE_URL?: string;
  /** HMAC secret signing the revalidate webhook body. */
  SITES_REVALIDATE_SECRET?: string;
}

export class PayloadCms extends Container<Env> {
  override defaultPort = 3000;
  override sleepAfter = '30m';

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const pairs: Record<string, string | undefined> = {
      DATABASE_URI: env.DATABASE_URI,
      PAYLOAD_SECRET: env.PAYLOAD_SECRET,
      // Public URL Payload mints admin/API links against.
      PAYLOAD_PUBLIC_SERVER_URL: 'https://cms.projectsites.dev',
      NEXT_PUBLIC_SERVER_URL: 'https://cms.projectsites.dev',
      NODE_ENV: 'production',
      PORT: '3000',
      HOSTNAME: '0.0.0.0',
      TZ: 'America/New_York',
      // R2 media storage + Resend email — must be forwarded into the container.
      S3_ENDPOINT: env.S3_ENDPOINT,
      S3_BUCKET: env.S3_BUCKET,
      S3_ACCESS_KEY_ID: env.S3_ACCESS_KEY_ID,
      S3_SECRET_ACCESS_KEY: env.S3_SECRET_ACCESS_KEY,
      RESEND_API_KEY: env.RESEND_API_KEY,
      OPENAI_API_KEY: env.OPENAI_API_KEY,
      BACKUP_SECRET: env.BACKUP_SECRET,
      SITES_REVALIDATE_URL: env.SITES_REVALIDATE_URL,
      SITES_REVALIDATE_SECRET: env.SITES_REVALIDATE_SECRET,
    };
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(pairs)) {
      if (typeof v === 'string' && v.length > 0) out[k] = v;
    }
    this.envVars = out;
  }

  override async fetch(request: Request): Promise<Response> {
    // First cold-start pushes the Postgres schema + boots Next — allow a generous window.
    await this.startAndWaitForPorts({
      ports: 3000,
      cancellationOptions: { portReadyTimeoutMS: 200_000, instanceGetTimeoutMS: 30_000 },
    });
    return this.containerFetch(request);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return getContainer(env.PAYLOAD, 'singleton').fetch(request);
  },
};
