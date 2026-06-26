import { Container, getContainer } from '@cloudflare/containers';

/**
 * auth.projectsites.dev — Logto self-hosted auth (OIDC) on CF Workers Containers.
 *
 * Mirrors infra/listmonk. Logto runs as a stateless CF Container; its schema + data
 * live in Neon Postgres (CF Containers have no persistent volume), so the container
 * hibernates after idle. The sign-in experience (login screen) serves on :3001;
 * the admin console on :3002 (proxied under /admin via the same host here, or a
 * dedicated admin host later). The worker integration (services/logto_provider.ts,
 * ADR-0006) points the main app's IdP at this endpoint.
 *
 * Deploy: `wrangler deploy` (builds the Dockerfile — Docker locally OR the
 * container-deploy.yaml CI workflow). Reachable at https://auth.projectsites.dev.
 */
interface Env {
  LOGTO: DurableObjectNamespace<Logto>;
  /** Neon Postgres connection string for the projectsites_logto database. */
  DB_URL: string;
  TRUST_PROXY_HEADER?: string;
}

export class Logto extends Container<Env> {
  defaultPort = 3001; // core server = the sign-in / OIDC endpoint (the login screen)
  sleepAfter = '15m';

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.envVars = {
      DB_URL: env.DB_URL,
      ENDPOINT: 'https://auth.projectsites.dev',
      ADMIN_ENDPOINT: 'https://auth.projectsites.dev/admin',
      PORT: '3001',
      ADMIN_PORT: '3002',
      TRUST_PROXY_HEADER: env.TRUST_PROXY_HEADER ?? '1',
      NODE_ENV: 'production',
    };
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Route every request to the single Logto container instance.
    return getContainer(env.LOGTO).fetch(request);
  },
};
