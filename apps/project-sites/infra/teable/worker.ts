import { Container, getContainer } from '@cloudflare/containers';

/**
 * teable.projectsites.dev — Teable (Postgres-backed no-code database) on CF Workers Containers.
 *
 * @remarks
 * Single-container deployment: ghcr.io/teableio/teable:latest runs the full app
 * (Next.js frontend + NestJS backend) on port 3000. The Worker acts as a transparent
 * HTTP proxy with /_health and /_ready endpoints.
 *
 * External data plane: Neon Postgres (DB `projectsites_teable`), Upstash Redis ×2
 * (cache + perf cache), R2 S3 (pending tokens — local storage for now).
 *
 * The Teable entrypoint (scripts/start.sh) runs DB migrations on every cold boot
 * then starts the NestJS backend + Next.js frontend. Cold boot ~60-90s.
 *
 * Deployed 2026-07-01 after Fly.io fallback proved unnecessary once env vars were
 * fixed (DATABASE_URL must include explicit :5432 port, S3 keys must be set if
 * using s3 provider).
 */
interface Env {
  TEABLE: DurableObjectNamespace<Teable>;
  SECRET_KEY: string;
  /** Neon Postgres direct URL with explicit port 5432. */
  DATABASE_URL: string;
  /** Upstash Redis for cache/queues (rediss://...). */
  BACKEND_CACHE_REDIS_URI: string;
  /** Upstash Redis for performance cache (rediss://...). */
  BACKEND_PERFORMANCE_CACHE: string;
}

const ACCOUNT_ID = '84fa0d1b16ff8086dd958c468ce7fd59';
const PUBLIC_ORIGIN = 'https://teable.projectsites.dev';

export class Teable extends Container<Env> {
  override defaultPort = 3000;
  override sleepAfter = '30m';

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);

    const out: Record<string, string> = {
      PORT: '3000',
      SOCKET_PORT: '3000',
      PUBLIC_ORIGIN,
      NEXT_ENV_IMAGES_ALL_REMOTE: 'true',
      LOG_LEVEL: 'info',
      // Postgres — Teable NestJS backend parses DATABASE_URL, Prisma uses PRISMA_DATABASE_URL
      DATABASE_URL: env.DATABASE_URL,
      PRISMA_DATABASE_URL: env.DATABASE_URL,
      // Redis
      BACKEND_CACHE_PROVIDER: 'redis',
      BACKEND_CACHE_REDIS_URI: env.BACKEND_CACHE_REDIS_URI,
      BACKEND_PERFORMANCE_CACHE: env.BACKEND_PERFORMANCE_CACHE,
      // Storage — local until R2 S3 tokens provisioned via CF dashboard
      BACKEND_STORAGE_PROVIDER: 'local',
      STORAGE_PREFIX: 'https://teable-assets.projectsites.dev',
    };

    if (env.SECRET_KEY) {
      out.SECRET_KEY = env.SECRET_KEY;
    }

    this.envVars = out;
  }

  override async onError(error: unknown): Promise<Response> {
    console.error('[teable onError]', error instanceof Error ? error.message : String(error));
    throw error;
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // /_health — verify container port 3000 is listening
    if (url.pathname === '/_health') {
      try {
        await this.startAndWaitForPorts({
          ports: 3000,
          // Teable cold boot: migrations + NestJS bootstrap + Next.js startup = 60-90s
          cancellationOptions: { portReadyTimeoutMS: 180_000 },
        });
        return new Response(
          JSON.stringify({ status: 'ok', service: 'teable', runtime: 'cf-containers' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      } catch (e) {
        return new Response(
          JSON.stringify({ status: 'error', message: 'Container not ready' }),
          { status: 503, headers: { 'Content-Type': 'application/json' } },
        );
      }
    }

    // /_ready — verify login page returns 200
    if (url.pathname === '/_ready') {
      try {
        await this.startAndWaitForPorts({
          ports: 3000,
          cancellationOptions: { portReadyTimeoutMS: 180_000 },
        });
        const res = await this.containerFetch(new Request(`${PUBLIC_ORIGIN}/`, { method: 'GET' }));
        const ready = res.status === 200;
        return new Response(
          JSON.stringify({ status: ready ? 'ready' : 'not_ready', http_status: res.status }),
          { status: ready ? 200 : 503, headers: { 'Content-Type': 'application/json' } },
        );
      } catch (e) {
        return new Response(
          JSON.stringify({ status: 'error', message: String(e) }),
          { status: 503, headers: { 'Content-Type': 'application/json' } },
        );
      }
    }

    // Proxy everything else to the Teable container
    await this.startAndWaitForPorts({
      ports: 3000,
      cancellationOptions: { portReadyTimeoutMS: 180_000 },
    });

    const response = await this.containerFetch(request);

    // Add security headers
    const newHeaders = new Headers(response.headers);
    newHeaders.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    newHeaders.set('X-Content-Type-Options', 'nosniff');
    newHeaders.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    newHeaders.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    });
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return getContainer(env.TEABLE, 'singleton').fetch(request);
  },
  /** Keep-warm: re-poke the container so it stays ready between requests. */
  async scheduled(_c: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    void getContainer(env.TEABLE, 'singleton')
      .fetch(new Request(`${PUBLIC_ORIGIN}/`))
      .catch(() => undefined);
  },
};
