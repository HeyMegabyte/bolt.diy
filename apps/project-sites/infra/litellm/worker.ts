import { Container, getContainer } from '@cloudflare/containers';

/**
 * llm.projectsites.dev — LiteLLM proxy + RouteLLM on CF Workers Containers.
 *
 * @remarks
 * LiteLLM proxy runs as a CF Container (port 4000) — the OpenAI-compatible `/v1`
 * gateway with routing, fallbacks, and budgets. RouteLLM ships in the same image
 * (a `router/*` model in config.yaml) so the "smart" model auto-routes strong-vs-weak.
 * Stateless; model creds + master key arrive via env (wrangler secrets).
 *
 * Container pattern mirrors the working infra/listmonk worker (@cloudflare/containers
 * ^0.3.3 → object-form startAndWaitForPorts). Deploy: `wrangler deploy` (builds the
 * Dockerfile image — needs Docker via WRANGLER_DOCKER_BIN). Reachable at
 * https://llm.projectsites.dev via an EXPLICIT Workers route (the *.projectsites.dev/*
 * wildcard on the main worker would otherwise shadow it — see listmonk-mail memory).
 */
interface Env {
  LITELLM: DurableObjectNamespace<LiteLLM>;
  /** Gates the proxy (sk-...). */
  LITELLM_MASTER_KEY: string;
  /** Model provider creds — optional until each provider is used. */
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  DEEPSEEK_API_KEY?: string;
}

export class LiteLLM extends Container<Env> {
  override defaultPort = 4000;
  override sleepAfter = '20m';

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Inject provider creds + master key as container env (the supported mechanism
    // for @cloudflare/containers 0.3.3; filter empties so a missing optional key
    // doesn't shadow a real one).
    const pairs: Record<string, string | undefined> = {
      LITELLM_MASTER_KEY: env.LITELLM_MASTER_KEY,
      OPENAI_API_KEY: env.OPENAI_API_KEY,
      ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
      DEEPSEEK_API_KEY: env.DEEPSEEK_API_KEY,
    };
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(pairs)) {
      if (typeof v === 'string' && v.length > 0) out[k] = v;
    }
    this.envVars = out;
  }

  override async fetch(request: Request): Promise<Response> {
    await this.startAndWaitForPorts({
      ports: 4000,
      cancellationOptions: { portReadyTimeoutMS: 120_000 },
    });
    return this.containerFetch(request);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return getContainer(env.LITELLM, 'singleton').fetch(request);
  },
};
