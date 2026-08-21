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
  /** Postgres (Neon projectsites_litellm) — virtual keys, spend tracking, budgets,
   *  Admin UI, STORE_MODEL_IN_DB. First boot runs Prisma migrations against it. */
  DATABASE_URL?: string;
  /** Upstash Redis (rediss://) — shared rate-limit/budget state + response caching. */
  REDIS_URL?: string;
  /** Encrypts provider creds stored in the DB (Admin UI). Required before STORE_MODEL_IN_DB. */
  LITELLM_SALT_KEY?: string;
  /** Slack incoming webhook for hanging-request / slow-response / budget alerts. */
  SLACK_WEBHOOK_URL?: string;
  /** Langfuse tracing (self-hosted v3 at traces.projectsites.dev). When set + config's
   *  success_callback includes "langfuse", every gateway call traces there. */
  LANGFUSE_PUBLIC_KEY?: string;
  LANGFUSE_SECRET_KEY?: string;
  LANGFUSE_HOST?: string;
}

export class LiteLLM extends Container<Env> {
  override defaultPort = 4000;
  override sleepAfter = '15m'; // scale-to-zero 2026-08-20

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
      DATABASE_URL: env.DATABASE_URL,
      REDIS_URL: env.REDIS_URL,
      LITELLM_SALT_KEY: env.LITELLM_SALT_KEY,
      SLACK_WEBHOOK_URL: env.SLACK_WEBHOOK_URL,
      LANGFUSE_PUBLIC_KEY: env.LANGFUSE_PUBLIC_KEY,
      LANGFUSE_SECRET_KEY: env.LANGFUSE_SECRET_KEY,
      LANGFUSE_HOST: env.LANGFUSE_HOST,
    };
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(pairs)) {
      if (typeof v === 'string' && v.length > 0) out[k] = v;
    }
    // Production posture (LiteLLM prod guide): structured JSON logs, ERROR-only FastAPI
    // logs, no load_dotenv. STORE_MODEL_IN_DB lets the Admin UI add models without a redeploy
    // — only when a DB + salt key are present (it encrypts stored provider creds).
    out.LITELLM_MODE = 'PRODUCTION';
    out.LITELLM_LOG = 'ERROR';
    // CF Containers pause the process between requests, so Langfuse's async background
    // flush can stall — flush every 1s so a trace lands while the container is still active.
    if (out.LANGFUSE_PUBLIC_KEY) out.LANGFUSE_FLUSH_INTERVAL = '1';
    if (out.DATABASE_URL && out.LITELLM_SALT_KEY) out.STORE_MODEL_IN_DB = 'True';
    this.envVars = out;
  }

  override async fetch(request: Request): Promise<Response> {
    await this.startAndWaitForPorts({
      // First boot runs Prisma migrations against Neon — allow a generous window.
      ports: 4000,
      cancellationOptions: { portReadyTimeoutMS: 220_000 },
    });
    return this.containerFetch(request);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return getContainer(env.LITELLM, 'singleton').fetch(request);
  },
};
