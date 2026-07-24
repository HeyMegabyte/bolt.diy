import { Container, getContainer } from '@cloudflare/containers';

/**
 * directus.projectsites.dev — Directus headless CMS on CF Workers Containers.
 *
 * Directus runs as a CF Container (port 8055).
 * Backing services: Neon Postgres (pooled connection) + Upstash Redis + R2 (S3-compatible storage).
 */
interface Env {
  DIRECTUS_CONTAINER: DurableObjectNamespace<DirectusContainerDO>;
  PUBLIC_URL: string;
  HOST: string;
  PORT: string;
  SECRET: string;
  ADMIN_EMAIL: string;
  ADMIN_PASSWORD: string;
  DB_CONNECTION_STRING: string;
  CACHE_ENABLED: string;
  CACHE_AUTO_PURGE: string;
  CACHE_STORE: string;
  REDIS: string;
  STORAGE_LOCATIONS: string;
  STORAGE_R2_DRIVER: string;
  STORAGE_R2_BUCKET: string;
  STORAGE_R2_REGION: string;
  STORAGE_R2_ENDPOINT: string;
  STORAGE_R2_KEY: string;
  STORAGE_R2_SECRET: string;
  EMAIL_TRANSPORT: string;
  EMAIL_SMTP_HOST: string;
  EMAIL_SMTP_PORT: string;
  EMAIL_SMTP_USER: string;
  EMAIL_SMTP_PASSWORD: string;
  EMAIL_SMTP_SECURE: string;
  EMAIL_FROM: string;
}

export class DirectusContainerDO extends Container<Env> {
  defaultPort = 8055;
  sleepAfter = '30m';

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.envVars = {
      PUBLIC_URL: env.PUBLIC_URL,
      HOST: env.HOST,
      PORT: env.PORT,
      SECRET: env.SECRET,
      ADMIN_EMAIL: env.ADMIN_EMAIL,
      ADMIN_PASSWORD: env.ADMIN_PASSWORD,
      DB_CLIENT: 'pg',
      DB_CONNECTION_STRING: env.DB_CONNECTION_STRING,
      DB_SSL__REJECT_UNAUTHORIZED: 'false',
      CACHE_ENABLED: env.CACHE_ENABLED,
      CACHE_AUTO_PURGE: env.CACHE_AUTO_PURGE,
      CACHE_STORE: env.CACHE_STORE,
      REDIS: env.REDIS,
      STORAGE_LOCATIONS: env.STORAGE_LOCATIONS,
      STORAGE_R2_DRIVER: env.STORAGE_R2_DRIVER,
      STORAGE_R2_BUCKET: env.STORAGE_R2_BUCKET,
      STORAGE_R2_REGION: env.STORAGE_R2_REGION,
      STORAGE_R2_ENDPOINT: env.STORAGE_R2_ENDPOINT,
      STORAGE_R2_KEY: env.STORAGE_R2_KEY,
      STORAGE_R2_SECRET: env.STORAGE_R2_SECRET,
      EMAIL_TRANSPORT: env.EMAIL_TRANSPORT,
      EMAIL_SMTP_HOST: env.EMAIL_SMTP_HOST,
      EMAIL_SMTP_PORT: env.EMAIL_SMTP_PORT,
      EMAIL_SMTP_USER: env.EMAIL_SMTP_USER,
      EMAIL_SMTP_PASSWORD: env.EMAIL_SMTP_PASSWORD,
      EMAIL_SMTP_SECURE: env.EMAIL_SMTP_SECURE,
      EMAIL_FROM: env.EMAIL_FROM,
    };
  }

  override async fetch(request: Request): Promise<Response> {
    await this.startAndWaitForPorts({
      ports: 8055,
      cancellationOptions: { portReadyTimeoutMS: 120_000, instanceGetTimeoutMS: 30_000 },
    });
    return this.containerFetch(request);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/_edge/ping') {
      return new Response('ok', { status: 200 });
    }

    const container = getContainer(env.DIRECTUS_CONTAINER, 'singleton');
    const response = await container.fetch(request);

    const headers = new Headers(response.headers);
    if (url.pathname.startsWith('/admin') || url.pathname.startsWith('/api')) {
      headers.set('Cache-Control', 'no-store, private');
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
};
