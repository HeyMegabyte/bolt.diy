import { Container, getContainer } from '@cloudflare/containers';

/**
 * integrations.projectsites.dev — Nango (unified OAuth/integrations) on CF
 * Workers Containers. Stateless container; data in Neon Postgres. Mirrors
 * infra/listmonk. Server (dashboard + API) on :3003.
 */
interface Env {
  NANGO_CONTAINER: DurableObjectNamespace<Nango>;
  NANGO_DATABASE_URL: string;
  NANGO_ENCRYPTION_KEY: string;
}

export class Nango extends Container<Env> {
  defaultPort = 3003;
  sleepAfter = '15m';
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.envVars = {
      NANGO_DATABASE_URL: env.NANGO_DATABASE_URL,
      NANGO_ENCRYPTION_KEY: env.NANGO_ENCRYPTION_KEY,
      NANGO_SERVER_URL: 'https://integrations.projectsites.dev',
      SERVER_PORT: '3003',
      NODE_ENV: 'production',
      TELEMETRY: 'false',
    };
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return getContainer(env.NANGO_CONTAINER, 'singleton').fetch(request);
  },
};
