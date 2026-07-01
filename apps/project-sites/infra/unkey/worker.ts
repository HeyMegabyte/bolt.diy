import { Container, getContainer } from '@cloudflare/containers';

/**
 * api.projectsites.dev — Unkey (API key management, AGPL) on Cloudflare Workers Containers.
 *
 * @remarks
 * ONE published Unkey Go-binary container (`unkeyed/unkey`) runs the API server behind this
 * Worker (cloudflare-lock-in-is-leverage — CF Containers, not Fly). AGPL stays isolated behind
 * the HTTP boundary (own container/subdomain, zero code import — agpl-isolation-via-http-boundary).
 * The container talks to the EXTERNAL data plane: TiDB Serverless (MySQL `unkey`) + Upstash
 * (Redis). ClickHouse (analytics) + Vault (encryption-at-rest) are optional and omitted for v1.
 * The API has no idle daemon to keep alive, but a `scheduled` cron re-pokes it so the FIRST
 * key-verification after idle doesn't pay a container cold-start (Unkey targets <40ms).
 */
interface Env {
  UNKEY: DurableObjectNamespace<Unkey>;
  /** Go MySQL DSN → TiDB `unkey` db (`user:pw@tcp(host:4000)/unkey?parseTime=true&tls=true`). */
  UNKEY_DATABASE_PRIMARY: string;
  /** Upstash Redis (rediss://default:<pw>@<host>:6379) — rate-limit counters + usage. */
  UNKEY_REDIS_URL: string;
  /** Bootstrap/admin root key. */
  UNKEY_ROOT_KEY: string;
}

const WEB_URL = 'https://api.projectsites.dev';

export class Unkey extends Container<Env> {
  // Unkey's API server binds UNKEY_HTTP_PORT (default 7070) on 0.0.0.0; CF health-checks it.
  override defaultPort = 7070;
  override sleepAfter = '30m'; // re-poked by the keep-warm cron so verifies stay warm
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // UNKEY_CONFIG points the server at the TOML baked into the image (COPY unkey.toml
    // /unkey.toml); its ${UNKEY_*} placeholders are env-expanded from the vars below.
    const out: Record<string, string> = { UNKEY_HTTP_PORT: '7070', UNKEY_CONFIG: '/unkey.toml' };
    if (env.UNKEY_DATABASE_PRIMARY) out.UNKEY_DATABASE_PRIMARY = env.UNKEY_DATABASE_PRIMARY;
    if (env.UNKEY_REDIS_URL) out.UNKEY_REDIS_URL = env.UNKEY_REDIS_URL;
    if (env.UNKEY_ROOT_KEY) out.UNKEY_ROOT_KEY = env.UNKEY_ROOT_KEY;
    this.envVars = out;
  }
  /** Log container-boot failures to observability (caller still gets the lib's retry page). */
  override async onError(error: unknown): Promise<Response> {
    console.error('[unkey onError]', error instanceof Error ? error.message : String(error));
    throw error;
  }
  override async fetch(request: Request): Promise<Response> {
    await this.startAndWaitForPorts({
      ports: 7070,
      // First boot runs DB migrations against TiDB — give it a generous window.
      cancellationOptions: { portReadyTimeoutMS: 180_000 },
    });
    return this.containerFetch(request);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return getContainer(env.UNKEY, 'singleton').fetch(request);
  },
  /** Keep-warm: re-poke the container so the next verify doesn't pay a cold start. */
  async scheduled(_c: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      getContainer(env.UNKEY, 'singleton')
        .fetch(new Request(`${WEB_URL}/v2/liveness`))
        .then(() => undefined)
        .catch(() => undefined),
    );
  },
};
