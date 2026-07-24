import { Container, getContainer } from '@cloudflare/containers';

/**
 * jobs.projectsites.dev — Hatchet (distributed task queue) on CF Containers.
 *
 * @remarks
 * Brian 2026-06-25: jobs. → Hatchet INSTEAD of Inngest (events. stays Inngest).
 * hatchet-lite runs as a single CF Container (port 8888 = dashboard + REST API),
 * Postgres → Neon. Pattern mirrors infra/listmonk + infra/skyvern + infra/langfuse
 * (@cloudflare/containers ^0.3.3 → object-form startAndWaitForPorts). Reachable via an
 * EXPLICIT Workers route jobs.projectsites.dev/* → this worker, which beats the
 * *.projectsites.dev/* wildcard AND overrides the main worker's Inngest jobs.-routing
 * (per the listmonk-mail custom-domain-vs-wildcard lesson). The serve.ts Inngest
 * jobs.-host match is removed once this is live so the intent is clean.
 */
interface Env {
  HATCHET: DurableObjectNamespace<Hatchet>;
  /** Neon Postgres URL (postgresql://...?sslmode=require). */
  DATABASE_URL: string;
  /** Two comma-separated random hex secrets for auth cookies. */
  SERVER_AUTH_COOKIE_SECRETS: string;
  /** base64 keysets from `hatchet-admin keyset create-local-keys` (see README). */
  SERVER_ENCRYPTION_MASTER_KEYSET?: string;
  SERVER_ENCRYPTION_JWT_PUBLIC_KEYSET?: string;
  SERVER_ENCRYPTION_JWT_PRIVATE_KEYSET?: string;
  /** Seed admin login. */
  SERVER_DEFAULT_ADMIN_EMAIL?: string;
  SERVER_DEFAULT_ADMIN_PASSWORD?: string;
}

export class Hatchet extends Container<Env> {
  override defaultPort = 8888;
  override sleepAfter = '20m';

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const pairs: Record<string, string | undefined> = {
      DATABASE_URL: env.DATABASE_URL,
      SERVER_AUTH_COOKIE_SECRETS: env.SERVER_AUTH_COOKIE_SECRETS,
      SERVER_ENCRYPTION_MASTER_KEYSET: env.SERVER_ENCRYPTION_MASTER_KEYSET,
      SERVER_ENCRYPTION_JWT_PUBLIC_KEYSET: env.SERVER_ENCRYPTION_JWT_PUBLIC_KEYSET,
      SERVER_ENCRYPTION_JWT_PRIVATE_KEYSET: env.SERVER_ENCRYPTION_JWT_PRIVATE_KEYSET,
      SERVER_DEFAULT_ADMIN_EMAIL: env.SERVER_DEFAULT_ADMIN_EMAIL,
      SERVER_DEFAULT_ADMIN_PASSWORD: env.SERVER_DEFAULT_ADMIN_PASSWORD,
      // Public origin + auth config for the lite server.
      SERVER_URL: 'https://jobs.projectsites.dev',
      SERVER_AUTH_SET_EMAIL_VERIFIED: 'true',
      SERVER_GRPC_BROADCAST_ADDRESS: 'jobs.projectsites.dev:443',
    };
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(pairs)) {
      if (typeof v === 'string' && v.length > 0) out[k] = v;
    }
    this.envVars = out;
  }

  override async fetch(request: Request): Promise<Response> {
    await this.startAndWaitForPorts({
      ports: 8888,
      cancellationOptions: { portReadyTimeoutMS: 180_000 },
    });
    return this.containerFetch(request);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return getContainer(env.HATCHET, 'singleton').fetch(request);
  },
};
