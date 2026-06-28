import { Container, getContainer } from '@cloudflare/containers';

/**
 * pm.megabyte.space — Plane (project management) on Cloudflare Workers Containers.
 *
 * @remarks
 * CF-native multi-process pattern (NOT Fly — `cloudflare-lock-in-is-leverage`):
 *   - THIS Worker is the proxy/router. It path-routes pm.megabyte.space to per-service
 *     Container DOs. No nginx/proxy container.
 *   - One Container DO per service. The backend image runs api (gunicorn :8000) + celery
 *     worker + celery beat together under supervisord, so one container covers all three.
 *   - Every container talks to the EXTERNAL data plane directly — Neon (Postgres `plane`),
 *     Upstash (Redis), CloudAMQP (RabbitMQ broker), R2 (S3 `plane-media`). Frontends call the
 *     API via the PUBLIC URL, which this Worker routes back to PlaneApi — so no
 *     container↔container private network is needed.
 *   - Celery has no HTTP port, so CF would hibernate the idle api container and stop the queue.
 *     The `scheduled` cron (every 2 min, wrangler triggers) re-pokes PlaneApi to keep it (and
 *     its celery worker/beat) warm.
 * Data plane provisioned 2026-06-27; see deploy.md. Creds arrive as wrangler secrets.
 */
interface Env {
  PLANE_API: DurableObjectNamespace<PlaneApi>;
  PLANE_WEB: DurableObjectNamespace<PlaneWeb>;
  PLANE_SPACE: DurableObjectNamespace<PlaneSpace>;
  PLANE_ADMIN: DurableObjectNamespace<PlaneAdmin>;
  /** Django SECRET_KEY (openssl rand -hex 32). */
  SECRET_KEY: string;
  /** Neon Postgres, DB `plane` (direct endpoint, ?sslmode=require). */
  DATABASE_URL: string;
  /** Upstash Redis (rediss://default:<pw>@<host>:6379) — Django cache. */
  REDIS_URL: string;
  /** CloudAMQP RabbitMQ (amqps://...) — Celery broker. */
  AMQP_URL: string;
  /** R2 S3 token (scoped to the plane-media bucket). */
  S3_ACCESS_KEY_ID: string;
  S3_SECRET_ACCESS_KEY: string;
}

const ACCOUNT_ID = '84fa0d1b16ff8086dd958c468ce7fd59';
const R2_ENDPOINT = `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`;
const R2_BUCKET = 'plane-media';
const WEB_URL = 'https://pm.megabyte.space';

/** Env shared by every Plane container (data plane + core). */
function baseEnv(env: Env): Record<string, string> {
  const pairs: Record<string, string | undefined> = {
    SECRET_KEY: env.SECRET_KEY,
    DATABASE_URL: env.DATABASE_URL,
    REDIS_URL: env.REDIS_URL,
    AMQP_URL: env.AMQP_URL,
  };
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(pairs)) if (typeof v === 'string' && v.length > 0) out[k] = v;
  out.WEB_URL = WEB_URL;
  out.CORS_ALLOWED_ORIGINS = WEB_URL;
  out.DEBUG = '0';
  return out;
}

/** Backend (api + celery worker + beat via supervisord). Also needs R2/S3 for uploads. */
export class PlaneApi extends Container<Env> {
  override defaultPort = 8000;
  override sleepAfter = '20m'; // re-poked by the keep-warm cron so celery never stops
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const out = baseEnv(env);
    out.GUNICORN_WORKERS = '2';
    out.USE_MINIO = '0';
    out.AWS_REGION = 'auto';
    out.AWS_S3_ENDPOINT_URL = R2_ENDPOINT;
    out.AWS_S3_BUCKET_NAME = R2_BUCKET;
    out.FILE_SIZE_LIMIT = '5242880';
    if (env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY) {
      out.AWS_ACCESS_KEY_ID = env.S3_ACCESS_KEY_ID;
      out.AWS_SECRET_ACCESS_KEY = env.S3_SECRET_ACCESS_KEY;
    }
    this.envVars = out;
  }
  override async fetch(request: Request): Promise<Response> {
    await this.startAndWaitForPorts({ ports: 8000, cancellationOptions: { portReadyTimeoutMS: 180_000 } });
    return this.containerFetch(request);
  }
}

/** Frontend image base — each Next.js app on :3000, pointed at the public API. */
abstract class PlaneFrontend extends Container<Env> {
  override defaultPort = 3000;
  override sleepAfter = '30m';
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.envVars = {
      NEXT_PUBLIC_API_BASE_URL: WEB_URL,
      NEXT_PUBLIC_DEPLOY_URL: `${WEB_URL}/spaces`,
      WEB_URL,
    };
  }
  override async fetch(request: Request): Promise<Response> {
    await this.startAndWaitForPorts({ ports: 3000, cancellationOptions: { portReadyTimeoutMS: 120_000 } });
    return this.containerFetch(request);
  }
}
export class PlaneWeb extends PlaneFrontend {}
export class PlaneSpace extends PlaneFrontend {}
export class PlaneAdmin extends PlaneFrontend {}

/** Path router: pm.megabyte.space → the right Plane service container. */
function route(env: Env, path: string): DurableObjectNamespace {
  if (path.startsWith('/api') || path.startsWith('/auth') || path.startsWith(`/${R2_BUCKET}`)) return env.PLANE_API;
  if (path.startsWith('/spaces')) return env.PLANE_SPACE;
  if (path.startsWith('/god-mode')) return env.PLANE_ADMIN;
  return env.PLANE_WEB;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const ns = route(env, new URL(request.url).pathname);
    return getContainer(ns, 'singleton').fetch(request);
  },
  /** Keep-warm: re-poke the api container so celery worker/beat keep draining the queue. */
  async scheduled(_c: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      getContainer(env.PLANE_API, 'singleton')
        .fetch(new Request('https://pm.megabyte.space/api/instances/'))
        .then(() => undefined)
        .catch(() => undefined),
    );
  },
};
