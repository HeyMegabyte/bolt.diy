import { Container, getContainer } from '@cloudflare/containers';

/**
 * billing.projectsites.dev — Lago usage-based billing on CF Workers Containers.
 *
 * Lago runs as a CF Container (port 3000): lago-api (Rails) + lago-front (baked
 * into public/). The Sidekiq worker runs separately on Fly.io (always-on polling).
 * Backing services: Neon Postgres + Upstash Redis.
 */
interface Env {
  LAGO: DurableObjectNamespace<LagoContainerDO>;
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
  // Lago starts nginx on 80 (front-end) + Rails on 3000 (API).
  // nginx proxies /api/* → :3000. We serve from :80 so the UI works at /.
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
      API_URL: '', // Empty = SPA calls same-origin; nginx proxies /api → :3000
      LAGO_DISABLE_SIGNUP: env.LAGO_DISABLE_SIGNUP ?? 'false',
      RAILS_ENV: 'production',
      RACK_ENV: 'production',
      PORT: '3000',
    };
  }

  override async fetch(request: Request): Promise<Response> {
    // Lago needs both nginx (:80) and Rails (:3000) ready.
    // nginx is the last to start — wait for it.
    await this.startAndWaitForPorts({
      ports: [80, 3000],
      cancellationOptions: { portReadyTimeoutMS: 120_000, instanceGetTimeoutMS: 30_000 },
    });
    return this.containerFetch(request);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Rewrite env-config.js so the SPA calls the correct API URL.
    // The Lago Docker image defaults API_URL to localhost:3000.
    // Empty API_URL = same-origin → nginx proxies /api/* → Rails :3000.
    if (url.pathname === '/env-config.js') {
      return new Response(
        `window.API_URL = "";\nwindow.LAGO_DOMAIN = "";\nwindow.APP_ENV = "production";\nwindow.LAGO_OAUTH_PROXY_URL = "https://proxy.getlago.com";\nwindow.LAGO_DISABLE_SIGNUP = "false";\nwindow.NANGO_PUBLIC_KEY = "";\nwindow.SENTRY_DSN = "";\nwindow.LAGO_DISABLE_PDF_GENERATION = "";\nwindow.LAGO_SUPERSET_URL = "";\n`,
        { headers: { 'Content-Type': 'application/javascript' } },
      );
    }

    const container = getContainer(env.LAGO, 'singleton');
    return container.fetch(request);
  },
};
