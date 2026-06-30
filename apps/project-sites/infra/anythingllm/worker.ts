import { Container, getContainer } from '@cloudflare/containers';

/**
 * anything.projectsites.dev — AnythingLLM AI knowledge base on CF Workers Containers.
 *
 * AnythingLLM runs as a CF Container (port 3001) with Neon PostgreSQL + PGVector
 * for durable state. Uploaded documents live on ephemeral container disk —
 * lost on cold start. Re-upload after restart or migrate to external storage.
 */
interface Env {
  ANYTHINGLLM: DurableObjectNamespace<AnythingLLMContainerDO>;
  // Secrets forwarded into the container
  JWT_SECRET: string;
  SIG_KEY: string;
  SIG_SALT: string;
  AUTH_TOKEN: string;
  PGVECTOR_CONNECTION_STRING: string;
}

export class AnythingLLMContainerDO extends Container<Env> {
  defaultPort = 3001;
  sleepAfter = '30m';

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.envVars = {
      SERVER_PORT: '3001',
      STORAGE_DIR: '/app/server/storage',
      JWT_SECRET: env.JWT_SECRET,
      SIG_KEY: env.SIG_KEY,
      SIG_SALT: env.SIG_SALT,
      AUTH_TOKEN: env.AUTH_TOKEN,
      // PostgreSQL + PGVector
      VECTOR_DB: 'pgvector',
      PGVECTOR_CONNECTION_STRING: env.PGVECTOR_CONNECTION_STRING,
      // Security hardening
      DISABLE_SWAGGER_DOCS: 'true',
      WORKSPACE_DELETION_PROTECTION: '1',
      // Chromium args for web scraping in Docker
      ANYTHINGLLM_CHROMIUM_ARGS: '--no-sandbox,--disable-setuid-sandbox',
      // Password policy
      PASSWORDMINCHAR: '12',
      // Disable HTTP logger noise in production
      DISABLE_HTTP_LOGGER: 'true',
    };
  }

  override async fetch(request: Request): Promise<Response> {
    await this.startAndWaitForPorts({
      ports: 3001,
      cancellationOptions: { portReadyTimeoutMS: 120_000, instanceGetTimeoutMS: 30_000 },
    });
    return this.containerFetch(request);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const container = getContainer(env.ANYTHINGLLM, 'singleton');
    return container.fetch(request);
  },
};
