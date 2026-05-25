import type { Env } from '../types/env.js';

/** PostHog event properties */
interface EventProperties {
  [key: string]: string | number | boolean | null | undefined;
}

/**
 * PostHog analytics client for Cloudflare Workers.
 * Server-side event capture via PostHog HTTP API.
 */
export async function captureEvent(
  env: Env,
  event: string,
  distinctId: string,
  properties: EventProperties = {},
): Promise<void> {
  if (!env.POSTHOG_API_KEY) return;

  const host = env.POSTHOG_HOST ?? 'https://us.i.posthog.com';

  try {
    await fetch(`${host}/capture/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: env.POSTHOG_API_KEY,
        event,
        distinct_id: distinctId,
        properties: {
          ...properties,
          $lib: 'project-sites-worker',
          $lib_version: '0.1.0',
        },
        timestamp: new Date().toISOString(),
      }),
    });
  } catch (err) {
    console.error(
      JSON.stringify({
        level: 'warn',
        service: 'analytics',
        message: 'Failed to capture PostHog event',
        error: err instanceof Error ? err.message : 'unknown',
      }),
    );
  }
}

/**
 * Capture a page view event.
 */
export async function capturePageView(
  env: Env,
  distinctId: string,
  url: string,
  properties: EventProperties = {},
): Promise<void> {
  await captureEvent(env, '$pageview', distinctId, {
    $current_url: url,
    ...properties,
  });
}

/**
 * Identify a user with properties.
 */
export async function identifyUser(
  env: Env,
  distinctId: string,
  properties: EventProperties = {},
): Promise<void> {
  if (!env.POSTHOG_API_KEY) return;

  const host = env.POSTHOG_HOST ?? 'https://us.i.posthog.com';

  try {
    await fetch(`${host}/capture/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: env.POSTHOG_API_KEY,
        event: '$identify',
        distinct_id: distinctId,
        properties: { $set: properties },
        timestamp: new Date().toISOString(),
      }),
    });
  } catch (err) {
    console.error(
      JSON.stringify({
        level: 'warn',
        service: 'analytics',
        message: 'Failed to identify user in PostHog',
        error: err instanceof Error ? err.message : 'unknown',
      }),
    );
  }
}

/**
 * Capture funnel events for conversion tracking.
 */
export async function captureFunnelEvent(
  env: Env,
  distinctId: string,
  funnelStep: string,
  orgId?: string,
  siteId?: string,
): Promise<void> {
  await captureEvent(env, `funnel_${funnelStep}`, distinctId, {
    org_id: orgId ?? null,
    site_id: siteId ?? null,
    funnel_step: funnelStep,
  });
}

/**
 * Capture an LLM generation event in PostHog's native LLM Observability
 * format. Property names follow the `$ai_*` convention so PostHog's LLM
 * dashboards auto-pick up the call without manual configuration.
 *
 * @remarks
 * Fire from every external LLM response (`external_llm.ts` callOpenAI /
 * callAnthropic), every Workers AI call (`ai_workflows.ts`), every voice
 * agent turn (`voice_agent.ts`). Pair with a `$ai_trace_id` so multi-step
 * agentic flows roll up cleanly.
 *
 * @example
 * ```ts
 * await captureLLMCall(env, {
 *   distinctId: orgId,
 *   provider: 'anthropic',
 *   model: 'claude-sonnet-4-6',
 *   promptId: 'research_brand',
 *   inputTokens: usage.input_tokens,
 *   outputTokens: usage.output_tokens,
 *   latencyMs: Date.now() - startedAt,
 *   costUsd,
 *   status: 'ok',
 *   traceId: requestId,
 * });
 * ```
 */
export async function captureLLMCall(
  env: Env,
  params: {
    distinctId: string;
    provider: 'openai' | 'anthropic' | 'workers_ai' | 'deepgram' | 'elevenlabs';
    model: string;
    promptId?: string;
    inputTokens?: number;
    outputTokens?: number;
    latencyMs: number;
    costUsd?: number;
    status: 'ok' | 'error' | 'timeout' | 'circuit_open';
    errorMessage?: string;
    traceId?: string;
    cacheHit?: boolean;
    gatewayUsed?: boolean;
  },
): Promise<void> {
  await captureEvent(env, '$ai_generation', params.distinctId, {
    $ai_provider: params.provider,
    $ai_model: params.model,
    $ai_prompt_id: params.promptId ?? null,
    $ai_input_tokens: params.inputTokens ?? 0,
    $ai_output_tokens: params.outputTokens ?? 0,
    $ai_latency: params.latencyMs,
    $ai_total_cost_usd: params.costUsd ?? 0,
    $ai_trace_id: params.traceId ?? null,
    $ai_is_error: params.status !== 'ok',
    $ai_error_message: params.errorMessage ?? null,
    $ai_cache_read: params.cacheHit ?? false,
    $ai_gateway: params.gatewayUsed ?? false,
    $ai_status: params.status,
  });
}
