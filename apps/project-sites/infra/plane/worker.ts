import { Container, getContainer } from '@cloudflare/containers';

/**
 * pm.megabyte.space — Plane (project management) on Cloudflare Workers Containers.
 *
 * @remarks
 * ONE Plane all-in-one (AIO) container runs every Plane process (web + space + admin + api +
 * celery worker + beat) behind Plane's own internal supervisor + proxy on a single port (80).
 * So this Worker is trivial: forward every request to the single container; no path-routing,
 * no per-service containers (`cloudflare-lock-in-is-leverage` — CF Containers, not Fly).
 * The container talks to the EXTERNAL data plane directly: Neon (Postgres `plane`), Upstash
 * (Redis), CloudAMQP (RabbitMQ broker), R2 (S3 `plane-media`). AIO runs DB migrations on boot.
 * Celery has no HTTP port, so the `scheduled` cron re-pokes the container to keep it (and its
 * worker/beat) warm between requests. Data plane provisioned 2026-06-27; see deploy.md.
 */
interface Env {
  PLANE: DurableObjectNamespace<Plane>;
  /** Django SECRET_KEY (openssl rand -hex 32). */
  SECRET_KEY: string;
  /** Neon Postgres, DB `plane` (direct endpoint, ?sslmode=require). */
  DATABASE_URL: string;
  /** Upstash Redis (rediss://default:<pw>@<host>:6379) — Django cache. */
  REDIS_URL: string;
  /** CloudAMQP RabbitMQ (amqps://...) — Celery broker. */
  AMQP_URL: string;
  /** R2 S3 token scoped to the plane-media bucket. */
  S3_ACCESS_KEY_ID: string;
  S3_SECRET_ACCESS_KEY: string;
}

const ACCOUNT_ID = '84fa0d1b16ff8086dd958c468ce7fd59';
const WEB_URL = 'https://pm.megabyte.space';

export class Plane extends Container<Env> {
  override defaultPort = 80;
  override sleepAfter = '20m'; // re-poked by the keep-warm cron so celery never stops
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const pairs: Record<string, string | undefined> = {
      SECRET_KEY: env.SECRET_KEY,
      DATABASE_URL: env.DATABASE_URL,
      REDIS_URL: env.REDIS_URL,
      AMQP_URL: env.AMQP_URL,
    };
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(pairs)) if (typeof v === 'string' && v.length > 0) out[k] = v;
    // public origin + CORS
    out.WEB_URL = WEB_URL;
    out.CORS_ALLOWED_ORIGINS = WEB_URL;
    out.NEXT_PUBLIC_API_BASE_URL = WEB_URL;
    out.NEXT_PUBLIC_DEPLOY_URL = `${WEB_URL}/spaces`;
    out.DEBUG = '0';
    out.GUNICORN_WORKERS = '2';
    // R2 (S3) object storage
    out.USE_MINIO = '0';
    out.AWS_REGION = 'auto';
    out.AWS_S3_ENDPOINT_URL = `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`;
    out.AWS_S3_BUCKET_NAME = 'plane-media';
    out.FILE_SIZE_LIMIT = '5242880';
    if (env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY) {
      out.AWS_ACCESS_KEY_ID = env.S3_ACCESS_KEY_ID;
      out.AWS_SECRET_ACCESS_KEY = env.S3_SECRET_ACCESS_KEY;
    }
    this.envVars = out;
  }
  override async fetch(request: Request): Promise<Response> {
    await this.startAndWaitForPorts({
      ports: 80,
      // First boot runs DB migrations + boots all processes — generous window.
      cancellationOptions: { portReadyTimeoutMS: 220_000 },
    });
    return this.containerFetch(request);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return getContainer(env.PLANE, 'singleton').fetch(request);
  },
  /** Keep-warm: re-poke the container so celery worker/beat keep draining the queue. */
  async scheduled(_c: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      getContainer(env.PLANE, 'singleton')
        .fetch(new Request('https://pm.megabyte.space/'))
        .then(() => undefined)
        .catch(() => undefined),
    );
  },
};
