import { Container, getContainer } from '@cloudflare/containers';

/**
 * browser.projectsites.dev — Skyvern LLM browser-automation agent on CF Containers.
 *
 * @remarks
 * Skyvern runs as a CF Container (port 8000) — an LLM-driven agent that operates a
 * real headless browser to complete web tasks. Postgres → Neon; an LLM key powers
 * the agent. Heavy image (bundled Chromium) → standard-4. AGPL-3.0, internal/admin use
 * (overrides the prior "Skyvern internal-only at skyvern.megabyte.space" note — Brian
 * wants it at browser.projectsites.dev).
 *
 * Container pattern mirrors the working infra/listmonk + infra/litellm workers
 * (@cloudflare/containers ^0.3.3 → object-form startAndWaitForPorts). Reachable via an
 * EXPLICIT Workers route (the *.projectsites.dev/* wildcard on the main worker would
 * otherwise shadow it — see listmonk-mail memory). Remove `browser` from the main
 * worker's system_service_landing map at cutover so the status page stops answering.
 */
interface Env {
  SKYVERN: DurableObjectNamespace<Skyvern>;
  /** Neon Postgres URI (postgresql://...). */
  DATABASE_STRING: string;
  /** LLM provider creds — at least one required to power the agent. */
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  /** Skyvern API auth bearer (gen + store as a secret). */
  SKYVERN_API_KEY?: string;
}

export class Skyvern extends Container<Env> {
  override defaultPort = 8000;
  override sleepAfter = '20m';

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const pairs: Record<string, string | undefined> = {
      DATABASE_STRING: env.DATABASE_STRING,
      OPENAI_API_KEY: env.OPENAI_API_KEY,
      ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
      SKYVERN_API_KEY: env.SKYVERN_API_KEY,
      // Enable the provider Skyvern should use for its agent reasoning.
      ENABLE_OPENAI: env.OPENAI_API_KEY ? 'true' : undefined,
      ENABLE_ANTHROPIC: env.ANTHROPIC_API_KEY ? 'true' : undefined,
    };
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(pairs)) {
      if (typeof v === 'string' && v.length > 0) out[k] = v;
    }
    this.envVars = out;
  }

  override async fetch(request: Request): Promise<Response> {
    await this.startAndWaitForPorts({
      ports: 8000,
      // Chromium-bundled image is slow to first-boot — generous port-ready window.
      cancellationOptions: { portReadyTimeoutMS: 180_000 },
    });
    // Skyvern is a FastAPI app with NO root route (bare `/` 404s). Map the host
    // root to the Swagger UI (/docs) so browser.projectsites.dev/ returns 200 from
    // the real app; every other path proxies through unchanged.
    const url = new URL(request.url);
    if (url.pathname === '/') {
      url.pathname = '/docs';
      request = new Request(url, request);
    }
    return this.containerFetch(request);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return getContainer(env.SKYVERN, 'singleton').fetch(request);
  },
};
