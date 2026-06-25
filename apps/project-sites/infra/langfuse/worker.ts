import { Container, getContainer } from '@cloudflare/containers';

/**
 * traces.projectsites.dev — Langfuse v2 (LLM observability) on CF Containers.
 *
 * @remarks
 * Langfuse v2 runs as a single Next.js CF Container (port 3000), Postgres → Neon.
 * Pattern mirrors infra/listmonk + infra/skyvern (@cloudflare/containers ^0.3.3 →
 * object-form startAndWaitForPorts). Reachable via an EXPLICIT Workers route (the
 * *.projectsites.dev/* wildcard would otherwise shadow it). Langfuse serves a UI at
 * `/` (200) — no root rewrite needed (unlike Skyvern's FastAPI).
 */
interface Env {
  LANGFUSE: DurableObjectNamespace<Langfuse>;
  /** Neon Postgres URL (postgresql://...?sslmode=require — Prisma/standard, NOT asyncpg). */
  DATABASE_URL: string;
  /** Public origin for NextAuth callbacks. */
  NEXTAUTH_URL: string;
  /** NextAuth session secret. */
  NEXTAUTH_SECRET: string;
  /** Salt for hashing API keys. */
  SALT: string;
  /** AES-256 key (64 hex chars) for at-rest encryption of integration creds. */
  ENCRYPTION_KEY?: string;
}

export class Langfuse extends Container<Env> {
  override defaultPort = 3000;
  override sleepAfter = '20m';

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const pairs: Record<string, string | undefined> = {
      DATABASE_URL: env.DATABASE_URL,
      NEXTAUTH_URL: env.NEXTAUTH_URL,
      NEXTAUTH_SECRET: env.NEXTAUTH_SECRET,
      SALT: env.SALT,
      ENCRYPTION_KEY: env.ENCRYPTION_KEY,
      // v2 single-container niceties: allow first-user signup, skip telemetry.
      TELEMETRY_ENABLED: 'false',
      HOSTNAME: '0.0.0.0',
    };
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(pairs)) {
      if (typeof v === 'string' && v.length > 0) out[k] = v;
    }
    this.envVars = out;
  }

  override async fetch(request: Request): Promise<Response> {
    await this.startAndWaitForPorts({
      ports: 3000,
      // Prisma migrate on first boot is slow — generous port-ready window.
      cancellationOptions: { portReadyTimeoutMS: 180_000 },
    });
    return this.containerFetch(request);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return getContainer(env.LANGFUSE, 'singleton').fetch(request);
  },
};
