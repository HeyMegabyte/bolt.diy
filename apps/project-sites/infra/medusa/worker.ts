# medusa.projectsites.dev — Medusa v2 commerce on Cloudflare Workers Containers.
#
# Front-door Worker: proxies all traffic to the Medusa Container DO.
# Routes `/` internally to `/app` so the root URL returns the Admin login page (200).
# Adds security headers, no caching for admin/API paths.

import { Container, getContainer } from '@cloudflare/containers';

interface Env {
  MEDUSA: DurableObjectNamespace<MedusaContainer>;
  DATABASE_URL: string;
  REDIS_URL: string;
  JWT_SECRET: string;
  COOKIE_SECRET: string;
  S3_ACCESS_KEY_ID: string;
  S3_SECRET_ACCESS_KEY: string;
  S3_ENDPOINT: string;
  S3_BUCKET: string;
  STRIPE_API_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
}

const BACKEND_URL = 'https://medusa.projectsites.dev';

export class MedusaContainer extends Container<Env> {
  override defaultPort = 9000;
  override sleepAfter = '30m'; // keep warm between admin requests

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const pairs: Record<string, string | undefined> = {
      DATABASE_URL: env.DATABASE_URL,
      REDIS_URL: env.REDIS_URL,
      JWT_SECRET: env.JWT_SECRET,
      COOKIE_SECRET: env.COOKIE_SECRET,
      S3_ACCESS_KEY_ID: env.S3_ACCESS_KEY_ID,
      S3_SECRET_ACCESS_KEY: env.S3_SECRET_ACCESS_KEY,
      S3_ENDPOINT: env.S3_ENDPOINT,
      S3_BUCKET: env.S3_BUCKET,
      STRIPE_API_KEY: env.STRIPE_API_KEY,
      STRIPE_WEBHOOK_SECRET: env.STRIPE_WEBHOOK_SECRET,
    };
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(pairs)) if (typeof v === 'string' && v.length > 0) out[k] = v;

    out.NODE_ENV = 'production';
    out.PORT = '9000';
    out.MEDUSA_WORKER_MODE = 'server';
    out.DISABLE_MEDUSA_ADMIN = 'false';
    out.MEDUSA_BACKEND_URL = BACKEND_URL;
    out.ADMIN_CORS = BACKEND_URL;
    out.AUTH_CORS = BACKEND_URL;
    out.STORE_CORS = BACKEND_URL;
    out.S3_FILE_URL = `${BACKEND_URL}/uploads`;
    out.S3_REGION = 'auto';
    this.envVars = out;
  }

  override async onError(error: unknown): Promise<Response> {
    console.error('[medusa onError]', error instanceof Error ? error.message : String(error));
    throw error;
  }

  override async fetch(request: Request): Promise<Response> {
    await this.startAndWaitForPorts({
      ports: 9000,
      cancellationOptions: { portReadyTimeoutMS: 180_000 },
    });
    return this.containerFetch(request);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Route `/` → `/app` so root URL shows admin login page
    if (path === '/') {
      const appUrl = new URL(request.url);
      appUrl.pathname = '/app';
      const container = getContainer(env.MEDUSA, 'singleton');
      const res = await container.fetch(new Request(appUrl, request));
      return res;
    }

    // Pass through: /app, /admin, /store, /auth, /health, /uploads, /api
    const container = getContainer(env.MEDUSA, 'singleton');
    const res = await container.fetch(request);

    // Add security headers
    const headers = new Headers(res.headers);
    headers.set('X-Frame-Options', 'DENY');
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

    // No caching for admin/API/auth
    if (path.startsWith('/admin') || path.startsWith('/api') || path.startsWith('/auth') || path === '/app') {
      headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    }

    return new Response(res.body, { status: res.status, headers });
  },
};
