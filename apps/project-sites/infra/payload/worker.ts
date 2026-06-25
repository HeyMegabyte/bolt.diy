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
}

export class PayloadCms extends Container<Env> {
  override defaultPort = 3000;
  override sleepAfter = '30m';

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.envVars = {
      DATABASE_URI: env.DATABASE_URI,
      PAYLOAD_SECRET: env.PAYLOAD_SECRET,
      // Public URL Payload mints admin/API links against.
      PAYLOAD_PUBLIC_SERVER_URL: 'https://cms.projectsites.dev',
      NEXT_PUBLIC_SERVER_URL: 'https://cms.projectsites.dev',
      NODE_ENV: 'production',
      PORT: '3000',
      HOSTNAME: '0.0.0.0',
      TZ: 'America/New_York',
    };
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
