import { Container, getContainer } from '@cloudflare/containers';

/**
 * llm.projectsites.dev — LiteLLM proxy on CF Workers Containers.
 *
 * @remarks
 * LiteLLM proxy runs as a CF Container (port 4000) — the OpenAI-compatible `/v1`
 * gateway with routing, fallbacks, and budgets. Model routing is native to
 * config.yaml (model_list + fallbacks); the `smart` model is the single entrypoint.
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
  /** Cloudflare Workers AI (tier-1 "ollama" leg) — a Workers-AI-scoped token + account id.
   *  When both are set, add an `ollama` model (cloudflare/@cf/...) to config.yaml's
   *  adaptive_router available_models. Optional: empty = the router runs tiers 2-3 only. */
  CLOUDFLARE_API_KEY?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
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
      CLOUDFLARE_API_KEY: env.CLOUDFLARE_API_KEY,
      CLOUDFLARE_ACCOUNT_ID: env.CLOUDFLARE_ACCOUNT_ID,
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
