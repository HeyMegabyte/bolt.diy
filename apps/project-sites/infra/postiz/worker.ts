import { Container, getContainer } from '@cloudflare/containers';

// social.projectsites.dev — Postiz social media scheduler.
// AGPL-3.0: only the HTTP API surface is consumed from outside this DO.
// Do NOT copy or adapt Postiz source into proprietary modules.

interface Env {
  POSTIZ: DurableObjectNamespace<Postiz>;
  POSTIZ_DATABASE_URL: string;
  POSTIZ_REDIS_URL: string;
  POSTIZ_JWT_SECRET: string;
}

export class Postiz extends Container<Env> {
  override defaultPort = 3000;
  override sleepAfter = '30m';

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.envVars = {
      MAIN_URL: 'https://social.projectsites.dev',
      NEXT_PUBLIC_BACKEND_URL: 'https://social.projectsites.dev',
      FRONTEND_URL: 'https://social.projectsites.dev',
      DATABASE_URL: env.POSTIZ_DATABASE_URL,
      REDIS_URL: env.POSTIZ_REDIS_URL,
      JWT_SECRET: env.POSTIZ_JWT_SECRET,
      PORT: '3000',
      TZ: 'America/New_York',
      // Disable telemetry to third-party Postiz servers.
      DISABLE_TELEMETRY: 'true',
    };
  }

  override async fetch(request: Request): Promise<Response> {
    await this.startAndWaitForPorts({
      ports: 3000,
      cancellationOptions: { portReadyTimeoutMS: 230_000, instanceGetTimeoutMS: 30_000 },
    });
    return this.containerFetch(request);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return getContainer(env.POSTIZ, 'singleton').fetch(request);
  },
};
