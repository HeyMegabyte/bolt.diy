import { Container, getContainer } from '@cloudflare/containers';

/**
 * auth.projectsites.dev — self-hosted Better Auth (OIDC IdP) on CF Workers Containers.
 *
 * Better Auth runs as a stateless CF Container (the Node server in src/index.ts); its
 * schema + data live in Neon Postgres (CF Containers have no persistent volume), so the
 * container hibernates after idle. The sign-in / OIDC endpoints serve on :3000. The
 * main app's IdentityProvider port (services/better_auth_provider.ts, ADR-0006) points
 * at this endpoint's `/api/auth/oauth2/*` routes.
 *
 * Deploy: `wrangler deploy` (builds the Dockerfile — Docker locally OR the
 * container-deploy.yaml CI workflow). Reachable at https://auth.projectsites.dev.
 */
interface Env {
  BETTER_AUTH: DurableObjectNamespace<BetterAuth>;
  /** Neon Postgres connection string for the projectsites_better_auth database. */
  DATABASE_URL: string;
  /** 32+ byte secret for session/token signing. */
  BETTER_AUTH_SECRET: string;
  /** First-party OIDC client the ProjectSites worker authenticates as. */
  OIDC_CLIENT_ID: string;
  OIDC_CLIENT_SECRET: string;
  OIDC_REDIRECT_URLS?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
}

export class BetterAuth extends Container<Env> {
  defaultPort = 3000; // the Hono/Node server = sign-in screen + OIDC endpoints
  sleepAfter = '15m';

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.envVars = {
      DATABASE_URL: env.DATABASE_URL,
      BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET,
      BETTER_AUTH_URL: 'https://auth.projectsites.dev',
      OIDC_CLIENT_ID: env.OIDC_CLIENT_ID,
      OIDC_CLIENT_SECRET: env.OIDC_CLIENT_SECRET,
      OIDC_REDIRECT_URLS:
        env.OIDC_REDIRECT_URLS ?? 'https://projectsites.dev/api/auth/betterauth/callback',
      GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID ?? '',
      GOOGLE_CLIENT_SECRET: env.GOOGLE_CLIENT_SECRET ?? '',
      PORT: '3000',
      NODE_ENV: 'production',
    };
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Route every request to the single Better Auth container instance.
    return getContainer(env.BETTER_AUTH).fetch(request);
  },
};
