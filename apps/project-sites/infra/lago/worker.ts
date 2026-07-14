import { Container, getContainer } from '@cloudflare/containers';

/**
 * billing.projectsites.dev — Lago usage-based billing on CF Workers Containers.
 *
 * Architecture:
 * - CF Container runs nginx on :80 (serves SPA front-end)
 * - Fly.io VM runs Rails API on :3000 + Sidekiq (connected to Neon + Upstash)
 * - Worker proxies /api/* → Fly Rails, everything else → CF Container nginx
 *
 * The Fly worker has working GraphQL (database reachable); the CF Container's
 * Rails has a DB connectivity issue, so we route API calls to Fly instead.
 */
interface Env {
  LAGO: DurableObjectNamespace<LagoContainerDO>;
  FLY_API_URL?: string;
  // Secrets forwarded into the container
  DATABASE_URL: string;
  REDIS_URL: string;
  REDIS_CACHE_URL?: string;
  SECRET_KEY_BASE: string;
  LAGO_RSA_PRIVATE_KEY: string;
  LAGO_ENCRYPTION_PRIMARY_KEY: string;
  LAGO_ENCRYPTION_DETERMINISTIC_KEY: string;
  LAGO_ENCRYPTION_KEY_DERIVATION_SALT: string;
  LAGO_FRONT_URL?: string;
  LAGO_API_URL?: string;
  LAGO_DISABLE_SIGNUP?: string;
}

export class LagoContainerDO extends Container<Env> {
  defaultPort = 80;
  sleepAfter = '30m';

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.envVars = {
      DATABASE_URL: env.DATABASE_URL,
      REDIS_URL: env.REDIS_URL,
      REDIS_CACHE_URL: env.REDIS_CACHE_URL ?? env.REDIS_URL,
      SECRET_KEY_BASE: env.SECRET_KEY_BASE,
      LAGO_RSA_PRIVATE_KEY: env.LAGO_RSA_PRIVATE_KEY,
      LAGO_ENCRYPTION_PRIMARY_KEY: env.LAGO_ENCRYPTION_PRIMARY_KEY,
      LAGO_ENCRYPTION_DETERMINISTIC_KEY: env.LAGO_ENCRYPTION_DETERMINISTIC_KEY,
      LAGO_ENCRYPTION_KEY_DERIVATION_SALT: env.LAGO_ENCRYPTION_KEY_DERIVATION_SALT,
      LAGO_FRONT_URL: env.LAGO_FRONT_URL ?? 'https://billing.projectsites.dev',
      LAGO_API_URL: env.LAGO_API_URL ?? 'https://billing.projectsites.dev',
      API_URL: '',
      LAGO_DISABLE_SIGNUP: env.LAGO_DISABLE_SIGNUP ?? 'false',
      RAILS_ENV: 'production',
      RACK_ENV: 'production',
      PORT: '3000',
    };
  }

  override async fetch(request: Request): Promise<Response> {
    await this.startAndWaitForPorts({
      ports: [80],
      cancellationOptions: { portReadyTimeoutMS: 120_000, instanceGetTimeoutMS: 30_000 },
    });
    return this.containerFetch(request);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Rewrite env-config.js so the SPA calls the correct API URL.
    if (url.pathname === '/env-config.js') {
      return new Response(
        'window.API_URL = "";' +
        'window.LAGO_DOMAIN = "billing.projectsites.dev";' +
        'window.APP_ENV = "production";' +
        'window.LAGO_OAUTH_PROXY_URL = "https://proxy.getlago.com";' +
        'window.LAGO_DISABLE_SIGNUP = "false";' +
        'window.NANGO_PUBLIC_KEY = "";' +
        'window.SENTRY_DSN = "";' +
        'window.LAGO_DISABLE_PDF_GENERATION = "";\n',
        { headers: { 'Content-Type': 'application/javascript' } },
      );
    }

    // Proxy /api/* and /health to Fly Rails (has working DB connectivity)
    // The CF Container's Rails can't reach Neon, but Fly can.
    const flyUrl = env.FLY_API_URL || 'https://lago-worker-ps.fly.dev';
    if (url.pathname.startsWith('/api/') || url.pathname === '/health') {
      const proxyUrl = new URL(url.pathname + url.search, flyUrl);
      const proxyReq = new Request(proxyUrl, {
        method: request.method,
        headers: request.headers,
        body: request.method !== 'GET' && request.method !== 'HEAD' ? await request.clone().arrayBuffer() : undefined,
        redirect: 'manual',
      });
      // Forward client IP
      proxyReq.headers.set('X-Forwarded-For', request.headers.get('CF-Connecting-IP') || '');
      proxyReq.headers.set('X-Forwarded-Proto', 'https');
      return fetch(proxyReq);
    }

    // Everything else → CF Container (serves SPA front-end)
    const container = getContainer(env.LAGO, 'singleton');
    return container.fetch(request);
  },
};
