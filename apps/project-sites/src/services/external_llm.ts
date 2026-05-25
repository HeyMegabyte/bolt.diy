/**
 * @module services/external_llm
 * @description Unified external LLM client for OpenAI and Anthropic APIs.
 *
 * Calls GPT-4o / Claude directly via fetch (no SDK needed in Workers).
 * GPT-4o is the primary provider for all research/vision calls.
 * Anthropic Claude is the fallback when GPT-4o fails.
 *
 * Features:
 * - Retry with exponential backoff + jitter
 * - Circuit breaker (5 failures in 60s → skip provider for 30s)
 * - Cloudflare AI Gateway routing (logs, caches, rate-limits, falls back)
 * - Anthropic prompt caching (`cache_control: ephemeral`) when system > 1024 chars
 * - Anthropic structured outputs beta (`output_schema`) when responseSchema passed
 *
 * @packageDocumentation
 */

import type { Env } from '../types/env.js';
import { withRetry, classifyError } from './retry.js';
import { captureLLMCall } from './analytics.js';

/**
 * Caller-supplied tracing context threaded through every external LLM call.
 *
 * @remarks
 * Used as the PostHog `distinctId` + `$ai_trace_id` so multi-step agentic
 * flows (research → brand → site-gen → score) roll up as a single trace in
 * PostHog's LLM Observability dashboards. Every field is optional so legacy
 * callers keep working with `'system'` as the distinctId fallback.
 *
 * **Callers that should pass this:**
 * - `workflows/site-generation.ts` (one traceId per workflow instance)
 * - `voice_agent.ts` (one traceId per voice turn — owned by Anthropic agent)
 * - `ai_workflows.ts` `runSiteGenerationWorkflowV2` (traceId per orchestration)
 * - `openai_research.ts` `researchAndFormulatePrompt` (traceId per research run)
 * - Any `/api/sites/improve-prompt` + `/api/sites/generate-prompt` route handler
 *
 * @example
 * ```ts
 * await callExternalLLM(env, {
 *   system: '...', user: '...',
 *   traceContext: { orgId: 'o_123', userId: 'u_456', traceId: requestId, promptId: 'research_brand' },
 * });
 * ```
 */
export interface TraceContext {
  /** Organization id — preferred PostHog distinctId when set. */
  orgId?: string;
  /** User id — fallback PostHog distinctId when orgId is absent. */
  userId?: string;
  /** Stable trace id (request id, workflow instance id) for multi-call rollup. */
  traceId?: string;
  /** Prompt id (e.g. `research_brand`, `generate_website`) for cost-per-prompt rollups. */
  promptId?: string;
}

/**
 * Parsed Anthropic Citations API entry surfaced on the response.
 *
 * @remarks
 * Populated only when the caller passes `documents` and `citations` is enabled
 * on the request. See {@link callExternalLLM} + Anthropic docs:
 * https://docs.anthropic.com/en/docs/build-with-claude/citations
 */
export interface AnthropicCitation {
  /** Index of the source document the citation refers to. */
  documentIndex: number;
  /** Optional document title supplied at request time. */
  documentTitle?: string;
  /** Verbatim text from the source document that was cited. */
  citedText: string;
  /** PDF page (when source is a PDF). */
  startPageNumber?: number;
  endPageNumber?: number;
  /** Plain-text char index (when source is text). */
  startCharIndex?: number;
  endCharIndex?: number;
  /** Custom-content block index (when source is custom JSON blocks). */
  startBlockIndex?: number;
  endBlockIndex?: number;
}

export interface ExternalLLMOptions {
  /** System prompt */
  system: string;
  /** User prompt */
  user: string;
  /** Temperature (0-1) */
  temperature?: number;
  /** Max tokens for response */
  maxTokens?: number;
  /** Request JSON output */
  jsonMode?: boolean;
  /** JSON schema for OpenAI structured output (response_format) */
  jsonSchema?: { name: string; schema: Record<string, unknown> };
  /** Preferred provider: 'openai' | 'anthropic' | 'auto' (default: 'auto' uses GPT-4o primary) */
  provider?: 'openai' | 'anthropic' | 'auto';
  /** Specific model override (e.g. 'gpt-4o-mini', 'claude-sonnet-4-6') */
  model?: string;
  /**
   * Optional JSON Schema for Anthropic structured outputs (beta).
   *
   * @remarks
   * When supplied, the Anthropic request gains:
   * - Header: `anthropic-beta: structured-outputs-2025-11-13`
   * - Body: `output_schema: { type: 'json_schema', schema: responseSchema }`
   *
   * **Incompatible with the Anthropic Citations API** (the server returns 400
   * if both are enabled on the same request). Pick one per call.
   */
  responseSchema?: Record<string, unknown>;
  /**
   * Optional source documents for Anthropic Citations API.
   *
   * @remarks
   * When supplied (and `responseSchema` is NOT set — the two are mutually
   * exclusive), each document is sent with `citations: { enabled: true }` so
   * Claude returns grounded answers with verbatim quotes + char/page/block
   * index ranges. Returned citations are surfaced on
   * {@link ExternalLLMResult.citations}.
   *
   * Source kinds:
   * - `text` — plain UTF-8; citations carry `start_char_index`/`end_char_index`
   * - `pdf` — base64-encoded PDF; citations carry `start_page_number`/`end_page_number`
   * - `custom` — array of `{type:'text',text}` blocks; citations carry block indices
   *
   * @see https://docs.anthropic.com/en/docs/build-with-claude/citations
   */
  documents?: Array<{
    title?: string;
    kind: 'text' | 'pdf' | 'custom';
    /** UTF-8 text for `text`; base64 for `pdf`; ignored for `custom`. */
    data?: string;
    /** For `custom` kind only — array of text content blocks. */
    blocks?: Array<{ type: 'text'; text: string }>;
  }>;
  /**
   * Tracing context for PostHog LLM Observability rollups.
   * @see {@link TraceContext}
   */
  traceContext?: TraceContext;
}

export interface ExternalLLMResult {
  output: string;
  model_used: string;
  provider: 'openai' | 'anthropic';
  latency_ms: number;
  token_count: number;
  cost_estimate: number;
  /**
   * Parsed Anthropic citations (when `documents` was passed + Anthropic was the
   * resolved provider). Empty array otherwise.
   */
  citations?: AnthropicCitation[];
  /**
   * True when the Anthropic response reported `usage.cache_read_input_tokens > 0`,
   * indicating the prompt-cache prefix was reused.
   */
  cache_hit?: boolean;
}

/**
 * Cost per 1M tokens (input/output) for current default models.
 *
 * @remarks Sourced from public pricing pages 2026-05:
 * - Opus 4.7 — $15 / $75
 * - Sonnet 4.6 — $3 / $15
 * - Haiku 4.5 — $1 / $5
 * - GPT-4o (2024-11-20) — $2.50 / $10
 * - GPT-4o-mini — $0.15 / $0.60
 */
const MODEL_COSTS: Record<string, { input: number; output: number }> = {
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'claude-opus-4-7': { input: 15, output: 75 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-haiku-4-5': { input: 1, output: 5 },
};

/** Default model IDs per provider — used when caller does not pass `model`. */
const DEFAULT_MODELS: Record<'openai' | 'anthropic', string> = {
  openai: 'gpt-4o-2024-11-20',
  anthropic: 'claude-sonnet-4-6',
};

/** Direct vendor base URLs. */
const DIRECT_URLS: Record<'openai' | 'anthropic', string> = {
  openai: 'https://api.openai.com',
  anthropic: 'https://api.anthropic.com',
};

// ─── AI Gateway Helper ──────────────────────────────────────────────────────

/**
 * Resolve the base URL for a provider, routing through Cloudflare AI Gateway
 * when both `AI_GATEWAY_ENABLED === "true"` AND `CF_ACCOUNT_ID` are set.
 *
 * Returns `https://gateway.ai.cloudflare.com/v1/{accountId}/projectsites/{provider}`
 * for gateway mode, else the direct vendor base URL.
 */
export function aiGatewayUrl(env: Env, provider: 'openai' | 'anthropic'): string {
  if (env.AI_GATEWAY_ENABLED === 'true' && env.CF_ACCOUNT_ID) {
    return `https://gateway.ai.cloudflare.com/v1/${env.CF_ACCOUNT_ID}/projectsites/${provider}`;
  }
  return DIRECT_URLS[provider];
}

/**
 * Run a fetch against the gateway URL; on 5xx, retry once against the direct
 * vendor URL with `X-PS-Gateway-Fallback: true` header for log filtering.
 *
 * Caller supplies `pathSuffix` (the part after the provider base, e.g.
 * `/v1/chat/completions` for OpenAI or `/v1/messages` for Anthropic).
 *
 * @returns Tuple of `[response, gatewayUsed]` — `gatewayUsed` is `true` when
 * the successful response came through the AI Gateway, `false` when it came
 * from the direct vendor URL (initial direct call OR 5xx fallback).
 */
async function fetchWithGatewayFallback(
  env: Env,
  provider: 'openai' | 'anthropic',
  pathSuffix: string,
  init: RequestInit,
): Promise<[Response, boolean]> {
  const gatewayActive = env.AI_GATEWAY_ENABLED === 'true' && !!env.CF_ACCOUNT_ID;
  const primaryBase = aiGatewayUrl(env, provider);
  const primaryUrl = `${primaryBase}${pathSuffix}`;

  const res = await fetch(primaryUrl, init);

  if (gatewayActive && res.status >= 500 && res.status < 600) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        service: 'external_llm',
        event: 'gateway_5xx_fallback',
        provider,
        status: res.status,
        message: `AI Gateway returned ${res.status}; falling back to direct vendor URL once`,
      }),
    );
    const directUrl = `${DIRECT_URLS[provider]}${pathSuffix}`;
    const fallbackHeaders = new Headers(init.headers ?? {});
    fallbackHeaders.set('X-PS-Gateway-Fallback', 'true');
    const fallbackRes = await fetch(directUrl, { ...init, headers: fallbackHeaders });
    return [fallbackRes, false];
  }

  return [res, gatewayActive];
}

// ─── Circuit Breaker State ──────────────────────────────────────────────────

interface CircuitBreakerState {
  failures: number;
  lastFailureTime: number;
  openUntil: number;
}

/** Circuit breaker: 5 failures in 60s → skip provider for 30s */
const CIRCUIT_FAILURE_THRESHOLD = 5;
const CIRCUIT_FAILURE_WINDOW_MS = 60_000;
const CIRCUIT_OPEN_DURATION_MS = 30_000;

const circuitState: Record<string, CircuitBreakerState> = {
  openai: { failures: 0, lastFailureTime: 0, openUntil: 0 },
  anthropic: { failures: 0, lastFailureTime: 0, openUntil: 0 },
};

/**
 * Check if a provider's circuit is open (should be skipped).
 */
function isCircuitOpen(provider: 'openai' | 'anthropic'): boolean {
  const state = circuitState[provider];
  if (Date.now() < state.openUntil) {
    return true;
  }
  // Reset if the open period has passed
  if (state.openUntil > 0 && Date.now() >= state.openUntil) {
    state.failures = 0;
    state.openUntil = 0;
  }
  return false;
}

/**
 * Record a failure for the circuit breaker.
 */
function recordFailure(provider: 'openai' | 'anthropic'): void {
  const state = circuitState[provider];
  const now = Date.now();

  // Reset counter if last failure was outside the window
  if (now - state.lastFailureTime > CIRCUIT_FAILURE_WINDOW_MS) {
    state.failures = 0;
  }

  state.failures++;
  state.lastFailureTime = now;

  if (state.failures >= CIRCUIT_FAILURE_THRESHOLD) {
    state.openUntil = now + CIRCUIT_OPEN_DURATION_MS;
    console.warn(
      JSON.stringify({
        level: 'warn',
        service: 'external_llm',
        event: 'circuit_open',
        provider,
        open_until: new Date(state.openUntil).toISOString(),
        message: `Circuit breaker opened for ${provider} after ${state.failures} failures`,
      }),
    );
  }
}

/**
 * Record a success — resets the failure counter.
 */
function recordSuccess(provider: 'openai' | 'anthropic'): void {
  const state = circuitState[provider];
  state.failures = 0;
  state.openUntil = 0;
}

// ─── Provider Selection ─────────────────────────────────────────────────────

/**
 * Choose provider. GPT-4o is ALWAYS primary for research/vision calls.
 * Anthropic is the fallback. Explicit preference overrides this.
 *
 * @remarks
 * The old A/B split randomness has been removed. OpenAI is deterministically
 * primary because GPT-4o provides better vision and research results.
 */
function chooseProvider(
  env: Env,
  preference?: 'openai' | 'anthropic' | 'auto',
): 'openai' | 'anthropic' {
  if (preference === 'openai') return 'openai';
  if (preference === 'anthropic') return 'anthropic';

  // GPT-4o is always primary (no more A/B split)
  const hasOpenAI = !!env.OPENAI_API_KEY;
  const hasAnthropic = !!env.ANTHROPIC_API_KEY;

  if (hasOpenAI) return 'openai';
  if (hasAnthropic) return 'anthropic';

  // Neither available — return openai so the error is clear
  return 'openai';
}

// ─── Provider Calls ─────────────────────────────────────────────────────────

/**
 * Call OpenAI Chat Completions API.
 *
 * Routes through `aiGatewayUrl(env, 'openai')` when AI Gateway is enabled;
 * falls back to direct vendor URL once on 5xx.
 *
 * @returns Text + token detail + `gatewayUsed` so the orchestrator can flag the
 * call in PostHog LLM Observability.
 */
async function callOpenAI(
  env: Env,
  apiKey: string,
  model: string,
  options: ExternalLLMOptions,
  messages?: Array<Record<string, unknown>>,
): Promise<{
  text: string;
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  gatewayUsed: boolean;
}> {
  const body: Record<string, unknown> = {
    model,
    messages: messages ?? [
      { role: 'system', content: options.system },
      { role: 'user', content: options.user },
    ],
    temperature: options.temperature ?? 0.3,
    max_completion_tokens: options.maxTokens ?? 8192,
  };

  if (options.jsonSchema) {
    body.response_format = {
      type: 'json_schema',
      json_schema: {
        name: options.jsonSchema.name,
        schema: options.jsonSchema.schema,
        strict: true,
      },
    };
  } else if (options.jsonMode) {
    body.response_format = { type: 'json_object' };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 240_000);

  let res: Response;
  let gatewayUsed = false;
  try {
    [res, gatewayUsed] = await fetchWithGatewayFallback(env, 'openai', '/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI API error ${res.status}: ${text}`);
  }

  const data = (await res.json()) as {
    choices: Array<{ message: { content: string } }>;
    usage?: { total_tokens: number; prompt_tokens?: number; completion_tokens?: number };
  };

  const inputTokens = data.usage?.prompt_tokens ?? 0;
  const outputTokens = data.usage?.completion_tokens ?? 0;
  return {
    text: data.choices[0]?.message?.content ?? '',
    tokens: data.usage?.total_tokens ?? inputTokens + outputTokens,
    inputTokens,
    outputTokens,
    gatewayUsed,
  };
}

/**
 * Call Anthropic Messages API.
 *
 * Features:
 * - Routes through `aiGatewayUrl(env, 'anthropic')` when AI Gateway is enabled;
 *   falls back to direct vendor URL once on 5xx.
 * - When `options.system.length > 1024`, sends the system as an array of
 *   `{type:'text', text, cache_control:{type:'ephemeral'}}` blocks for prompt
 *   caching (Anthropic minimum cacheable prefix is 1024 tokens on Sonnet and
 *   4096 on Opus/Haiku — using char count as a conservative proxy avoids
 *   tokenizing the prompt on the worker).
 * - When `options.responseSchema` is set, attaches structured-outputs beta
 *   header + `output_schema` block.
 *
 * @remarks
 * **Structured outputs is incompatible with the Anthropic Citations API.**
 * Setting both `responseSchema` and citations on the same request returns 400.
 * Pick one per call.
 */
/**
 * Shape of a single Anthropic response content block — `text` blocks may carry
 * a `citations[]` array when the Citations API is enabled on the request.
 */
interface AnthropicContentBlock {
  type: string;
  text?: string;
  citations?: Array<{
    type:
      | 'char_location'
      | 'page_location'
      | 'content_block_location'
      | 'web_search_result_location';
    document_index: number;
    document_title?: string;
    cited_text: string;
    start_char_index?: number;
    end_char_index?: number;
    start_page_number?: number;
    end_page_number?: number;
    start_block_index?: number;
    end_block_index?: number;
  }>;
}

async function callAnthropic(
  env: Env,
  apiKey: string,
  model: string,
  options: ExternalLLMOptions,
  messages?: Array<Record<string, unknown>>,
): Promise<{
  text: string;
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheHit: boolean;
  citations: AnthropicCitation[];
  gatewayUsed: boolean;
}> {
  // Build system: either a plain string or an array with cache_control on the
  // last block when the system prompt is long enough to be worth caching.
  const systemPayload: string | Array<Record<string, unknown>> =
    options.system.length > 1024
      ? [{ type: 'text', text: options.system, cache_control: { type: 'ephemeral' } }]
      : options.system;

  // When the caller supplies source documents, fold them into the first user
  // message as `document` content blocks per the Citations API spec.
  // Mutually exclusive with `responseSchema` — the server returns 400 if both
  // are set on the same request.
  const hasDocuments = !!options.documents?.length && !options.responseSchema;

  let resolvedMessages: Array<Record<string, unknown>>;
  if (messages) {
    resolvedMessages = messages;
  } else if (hasDocuments) {
    const documentBlocks = options.documents!.map((doc) => {
      const base: Record<string, unknown> = {
        type: 'document',
        citations: { enabled: true },
        title: doc.title,
      };
      if (doc.kind === 'text') {
        base.source = { type: 'text', media_type: 'text/plain', data: doc.data ?? '' };
      } else if (doc.kind === 'pdf') {
        base.source = { type: 'base64', media_type: 'application/pdf', data: doc.data ?? '' };
      } else {
        base.source = { type: 'content', content: doc.blocks ?? [] };
      }
      return base;
    });
    resolvedMessages = [
      {
        role: 'user',
        content: [...documentBlocks, { type: 'text', text: options.user }],
      },
    ];
  } else {
    resolvedMessages = [{ role: 'user', content: options.user }];
  }

  const body: Record<string, unknown> = {
    model,
    system: systemPayload,
    messages: resolvedMessages,
    temperature: options.temperature ?? 0.3,
    max_tokens: options.maxTokens ?? 8192,
  };

  // Optional structured outputs (beta). Mutually exclusive with Citations API.
  if (options.responseSchema) {
    body.output_schema = { type: 'json_schema', schema: options.responseSchema };
  }

  const headers: Record<string, string> = {
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
    'Content-Type': 'application/json',
  };
  if (options.responseSchema) {
    headers['anthropic-beta'] = 'structured-outputs-2025-11-13';
  }

  // 8-minute timeout for Claude Opus large generation calls (32K tokens can take 2-4 min)
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 480_000);

  let res: Response;
  let gatewayUsed = false;
  try {
    [res, gatewayUsed] = await fetchWithGatewayFallback(env, 'anthropic', '/v1/messages', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${text}`);
  }

  const data = (await res.json()) as {
    content: AnthropicContentBlock[];
    usage?: {
      input_tokens: number;
      output_tokens: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
  };

  const text = data.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('');

  const inputTokens = data.usage?.input_tokens ?? 0;
  const outputTokens = data.usage?.output_tokens ?? 0;
  const tokens = inputTokens + outputTokens;
  const cacheHit = (data.usage?.cache_read_input_tokens ?? 0) > 0;

  // Flatten citations from every text block into a single array. Anthropic
  // returns one entry per cited span; downstream consumers can group by
  // document_index to reconstruct per-source reference lists.
  const citations: AnthropicCitation[] = [];
  for (const block of data.content) {
    if (!block.citations) continue;
    for (const c of block.citations) {
      citations.push({
        documentIndex: c.document_index,
        documentTitle: c.document_title,
        citedText: c.cited_text,
        startCharIndex: c.start_char_index,
        endCharIndex: c.end_char_index,
        startPageNumber: c.start_page_number,
        endPageNumber: c.end_page_number,
        startBlockIndex: c.start_block_index,
        endBlockIndex: c.end_block_index,
      });
    }
  }

  return { text, tokens, inputTokens, outputTokens, cacheHit, citations, gatewayUsed };
}

// ─── Cost Estimation ────────────────────────────────────────────────────────

/**
 * Estimate cost in USD when exact input/output token counts are available.
 *
 * @example
 * ```ts
 * const cost = estimateCostPrecise('claude-sonnet-4-6', 1500, 600); // → ~$0.0135
 * ```
 */
function estimateCostPrecise(model: string, inputTokens: number, outputTokens: number): number {
  const key = Object.keys(MODEL_COSTS).find((k) => model.includes(k));
  if (!key) return 0;
  const costs = MODEL_COSTS[key];
  return (inputTokens * costs.input + outputTokens * costs.output) / 1_000_000;
}

/**
 * Resolve the PostHog distinctId for a trace context.
 *
 * Priority: `orgId` → `userId` → `'system'`. Analytics-only — never used for
 * authorization, never logged at info level (PII surface).
 */
function resolveDistinctId(traceContext?: TraceContext): string {
  return traceContext?.orgId ?? traceContext?.userId ?? 'system';
}

/**
 * Fire-and-forget PostHog LLM Observability capture. Wrapped in try/catch so
 * analytics failures NEVER bubble into the LLM response path.
 *
 * @see {@link captureLLMCall}
 */
async function safeCaptureLLM(
  env: Env,
  params: Parameters<typeof captureLLMCall>[1],
): Promise<void> {
  try {
    await captureLLMCall(env, params);
  } catch (err) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        service: 'external_llm',
        event: 'analytics_capture_failed',
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}

// ─── Main LLM Call ──────────────────────────────────────────────────────────

/**
 * Call an external LLM (OpenAI or Anthropic) with automatic fallback.
 *
 * Uses GPT-4o as the primary provider with retry + exponential backoff.
 * Falls back to Anthropic Claude if GPT-4o fails after retries.
 * Circuit breaker skips a provider if it fails 5 times within 60 seconds.
 *
 * @param env - Worker environment with API keys
 * @param options - Prompt configuration
 * @returns LLM response with metadata
 *
 * @example
 * ```ts
 * const result = await callExternalLLM(env, {
 *   system: 'You are a web designer.',
 *   user: 'Generate a site plan for a bakery.',
 *   jsonMode: true,
 *   maxTokens: 4000,
 * });
 * ```
 */
export async function callExternalLLM(
  env: Env,
  options: ExternalLLMOptions,
): Promise<ExternalLLMResult> {
  const primary = chooseProvider(env, options.provider);
  const fallback: 'openai' | 'anthropic' = primary === 'openai' ? 'anthropic' : 'openai';

  const providers: Array<'openai' | 'anthropic'> = [primary, fallback];

  const distinctId = resolveDistinctId(options.traceContext);
  const traceId = options.traceContext?.traceId;
  const promptId = options.traceContext?.promptId;

  for (const provider of providers) {
    // Circuit breaker: skip provider if circuit is open
    if (isCircuitOpen(provider)) {
      console.warn(
        JSON.stringify({
          level: 'info',
          service: 'external_llm',
          event: 'circuit_open_skip',
          provider,
          message: `Skipping ${provider} — circuit breaker is open`,
        }),
      );
      const skipModel = options.model ?? DEFAULT_MODELS[provider];
      void safeCaptureLLM(env, {
        distinctId,
        provider,
        model: skipModel,
        promptId,
        latencyMs: 0,
        status: 'circuit_open',
        traceId,
      });
      continue;
    }

    const apiKey =
      provider === 'openai' ? env.OPENAI_API_KEY : (env.ANTHROPIC_API_KEY as string | undefined);

    if (!apiKey) continue;

    const model = options.model ?? DEFAULT_MODELS[provider];
    const start = Date.now();

    try {
      const result = await withRetry(
        () =>
          provider === 'openai'
            ? callOpenAI(env, apiKey, model, options)
            : callAnthropic(env, apiKey, model, options),
        {
          maxRetries: 3,
          baseDelayMs: 1000,
          onRetry: (attempt, err, delayMs) => {
            console.warn(
              JSON.stringify({
                level: 'warn',
                service: 'external_llm',
                event: 'retry',
                provider,
                model,
                attempt,
                delay_ms: delayMs,
                error_category: classifyError(err),
                error: err instanceof Error ? err.message : String(err),
              }),
            );
          },
        },
      );

      const latency = Date.now() - start;
      recordSuccess(provider);

      // Result shape diverges between providers — only Anthropic carries
      // `cacheHit` + `citations` + `inputTokens`/`outputTokens`/`gatewayUsed`.
      // Use a loose cast for the extended fields rather than threading a
      // discriminated union through every callsite.
      const r = result as Record<string, unknown> & { text: string; tokens: number };
      const cacheHit = Boolean(r.cacheHit);
      const citations = (Array.isArray(r.citations) ? r.citations : []) as AnthropicCitation[];
      const inputTokens = typeof r.inputTokens === 'number' ? r.inputTokens : 0;
      const outputTokens = typeof r.outputTokens === 'number' ? r.outputTokens : 0;
      const gatewayUsed = Boolean(r.gatewayUsed);
      const costUsd = estimateCostPrecise(model, inputTokens, outputTokens);

      console.warn(
        JSON.stringify({
          level: 'info',
          service: 'external_llm',
          event: 'call_success',
          provider,
          model,
          latency_ms: latency,
          tokens: result.tokens,
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          cache_hit: cacheHit,
          gateway_used: gatewayUsed,
          citations_count: citations.length,
          output_length: result.text.length,
        }),
      );

      void safeCaptureLLM(env, {
        distinctId,
        provider,
        model,
        promptId,
        inputTokens,
        outputTokens,
        latencyMs: latency,
        costUsd,
        status: 'ok',
        traceId,
        cacheHit,
        gatewayUsed,
      });

      return {
        output: result.text,
        model_used: model,
        provider,
        latency_ms: latency,
        token_count: result.tokens,
        cost_estimate: costUsd,
        citations,
        cache_hit: cacheHit,
      };
    } catch (err) {
      const latency = Date.now() - start;
      const errorCategory = classifyError(err);
      recordFailure(provider);

      console.warn(
        JSON.stringify({
          level: 'warn',
          service: 'external_llm',
          event: 'provider_exhausted',
          provider,
          model,
          latency_ms: latency,
          error_category: errorCategory,
          error: err instanceof Error ? err.message : String(err),
          message:
            provider === fallback
              ? `Both providers failed`
              : `${provider} failed after retries, trying ${fallback}`,
        }),
      );

      void safeCaptureLLM(env, {
        distinctId,
        provider,
        model,
        promptId,
        latencyMs: latency,
        status: errorCategory === 'timeout' ? 'timeout' : 'error',
        errorMessage: err instanceof Error ? err.message : String(err),
        traceId,
      });

      // If this is the fallback too, rethrow
      if (provider === fallback) throw err;
    }
  }

  throw new Error('No LLM provider available — set OPENAI_API_KEY or ANTHROPIC_API_KEY');
}

// ─── Vision Call ────────────────────────────────────────────────────────────

/**
 * Call an external LLM with vision capability (image analysis).
 *
 * Uses GPT-4o vision as primary, falls back to Anthropic Claude vision.
 * Accepts either an image URL or base64-encoded image data.
 *
 * @param env - Worker environment with API keys
 * @param options - Prompt configuration with optional image data
 * @returns LLM response with metadata
 *
 * @example
 * ```ts
 * const result = await callExternalLLMWithVision(env, {
 *   system: 'You are a visual brand analyst.',
 *   user: 'Describe the brand colors and logo in this screenshot.',
 *   imageUrl: 'https://example.com/screenshot.png',
 *   maxTokens: 2000,
 * });
 * ```
 */
export async function callExternalLLMWithVision(
  env: Env,
  options: ExternalLLMOptions & { imageUrl?: string; imageBase64?: string },
): Promise<ExternalLLMResult> {
  if (!options.imageUrl && !options.imageBase64) {
    // No image provided, fall back to standard text call
    return callExternalLLM(env, options);
  }

  const primary = chooseProvider(env, options.provider);
  const fallback: 'openai' | 'anthropic' = primary === 'openai' ? 'anthropic' : 'openai';

  const providers: Array<'openai' | 'anthropic'> = [primary, fallback];

  const distinctId = resolveDistinctId(options.traceContext);
  const traceId = options.traceContext?.traceId;
  const promptId = options.traceContext?.promptId;

  for (const provider of providers) {
    if (isCircuitOpen(provider)) {
      console.warn(
        JSON.stringify({
          level: 'info',
          service: 'external_llm',
          event: 'circuit_open_skip_vision',
          provider,
          message: `Skipping ${provider} vision — circuit breaker is open`,
        }),
      );
      const skipModel = options.model ?? DEFAULT_MODELS[provider];
      void safeCaptureLLM(env, {
        distinctId,
        provider,
        model: skipModel,
        promptId,
        latencyMs: 0,
        status: 'circuit_open',
        traceId,
      });
      continue;
    }

    const apiKey =
      provider === 'openai' ? env.OPENAI_API_KEY : (env.ANTHROPIC_API_KEY as string | undefined);

    if (!apiKey) continue;

    const model = options.model ?? DEFAULT_MODELS[provider];
    const start = Date.now();

    try {
      const result = await withRetry(
        () => {
          if (provider === 'openai') {
            return callOpenAIWithVision(env, apiKey, model, options);
          }
          return callAnthropicWithVision(env, apiKey, model, options);
        },
        {
          maxRetries: 3,
          baseDelayMs: 1000,
          onRetry: (attempt, err, delayMs) => {
            console.warn(
              JSON.stringify({
                level: 'warn',
                service: 'external_llm',
                event: 'retry_vision',
                provider,
                model,
                attempt,
                delay_ms: delayMs,
                error_category: classifyError(err),
                error: err instanceof Error ? err.message : String(err),
              }),
            );
          },
        },
      );

      const latency = Date.now() - start;
      recordSuccess(provider);

      const r = result as Record<string, unknown> & { text: string; tokens: number };
      const cacheHit = Boolean(r.cacheHit);
      const citations = (Array.isArray(r.citations) ? r.citations : []) as AnthropicCitation[];
      const inputTokens = typeof r.inputTokens === 'number' ? r.inputTokens : 0;
      const outputTokens = typeof r.outputTokens === 'number' ? r.outputTokens : 0;
      const gatewayUsed = Boolean(r.gatewayUsed);
      const costUsd = estimateCostPrecise(model, inputTokens, outputTokens);

      console.warn(
        JSON.stringify({
          level: 'info',
          service: 'external_llm',
          event: 'vision_call_success',
          provider,
          model,
          latency_ms: latency,
          tokens: result.tokens,
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          cache_hit: cacheHit,
          gateway_used: gatewayUsed,
          output_length: result.text.length,
        }),
      );

      void safeCaptureLLM(env, {
        distinctId,
        provider,
        model,
        promptId: promptId ? `${promptId}:vision` : 'vision',
        inputTokens,
        outputTokens,
        latencyMs: latency,
        costUsd,
        status: 'ok',
        traceId,
        cacheHit,
        gatewayUsed,
      });

      return {
        output: result.text,
        model_used: model,
        provider,
        latency_ms: latency,
        token_count: result.tokens,
        cost_estimate: costUsd,
        citations,
        cache_hit: cacheHit,
      };
    } catch (err) {
      const latency = Date.now() - start;
      const errorCategory = classifyError(err);
      recordFailure(provider);

      console.warn(
        JSON.stringify({
          level: 'warn',
          service: 'external_llm',
          event: 'vision_provider_exhausted',
          provider,
          model,
          latency_ms: latency,
          error_category: errorCategory,
          error: err instanceof Error ? err.message : String(err),
          message:
            provider === fallback
              ? `Both vision providers failed`
              : `${provider} vision failed after retries, trying ${fallback}`,
        }),
      );

      void safeCaptureLLM(env, {
        distinctId,
        provider,
        model,
        promptId: promptId ? `${promptId}:vision` : 'vision',
        latencyMs: latency,
        status: errorCategory === 'timeout' ? 'timeout' : 'error',
        errorMessage: err instanceof Error ? err.message : String(err),
        traceId,
      });

      if (provider === fallback) throw err;
    }
  }

  throw new Error('No LLM vision provider available — set OPENAI_API_KEY or ANTHROPIC_API_KEY');
}

// ─── Vision Provider Implementations ────────────────────────────────────────

/**
 * Call OpenAI with vision (image_url in messages).
 */
async function callOpenAIWithVision(
  env: Env,
  apiKey: string,
  model: string,
  options: ExternalLLMOptions & { imageUrl?: string; imageBase64?: string },
): Promise<{ text: string; tokens: number }> {
  const imageContent: Record<string, unknown> = options.imageUrl
    ? { type: 'image_url', image_url: { url: options.imageUrl, detail: 'high' } }
    : {
        type: 'image_url',
        image_url: { url: `data:image/png;base64,${options.imageBase64}`, detail: 'high' },
      };

  const messages = [
    { role: 'system', content: options.system },
    {
      role: 'user',
      content: [{ type: 'text', text: options.user }, imageContent],
    },
  ];

  return callOpenAI(env, apiKey, model, options, messages);
}

/**
 * Call Anthropic with vision (base64 image in messages).
 */
async function callAnthropicWithVision(
  env: Env,
  apiKey: string,
  model: string,
  options: ExternalLLMOptions & { imageUrl?: string; imageBase64?: string },
): Promise<{ text: string; tokens: number }> {
  // Anthropic requires base64 for images; if we only have a URL, fetch it
  let base64Data = options.imageBase64;
  let mediaType = 'image/png';

  if (!base64Data && options.imageUrl) {
    const imgRes = await fetch(options.imageUrl);
    if (!imgRes.ok) {
      throw new Error(`Failed to fetch image for Anthropic vision: ${imgRes.status}`);
    }
    const contentType = imgRes.headers.get('content-type') ?? 'image/png';
    mediaType = contentType.split(';')[0].trim();
    const buffer = await imgRes.arrayBuffer();
    // Convert ArrayBuffer to base64
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    base64Data = btoa(binary);
  }

  const messages = [
    {
      role: 'user',
      content: [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: mediaType,
            data: base64Data,
          },
        },
        { type: 'text', text: options.user },
      ],
    },
  ];

  return callAnthropic(env, apiKey, model, options, messages);
}

// ─── OpenAI Files API ───────────────────────────────────────────────────────

/**
 * Upload a document to the OpenAI Files API for downstream use with Assistants,
 * the Responses API file-search tool, or batch jobs.
 *
 * @remarks
 * - Endpoint: `POST https://api.openai.com/v1/files` (multipart/form-data)
 * - `purpose: 'assistants'` is the broadest grant; switch to `'batch'` or
 *   `'fine-tune'` for those specific call paths.
 * - Files persist on OpenAI infrastructure until deleted via
 *   `DELETE /v1/files/{file_id}` — call site is responsible for lifecycle.
 * - This helper is **unwired** by design: no caller in this turn. Reserved for
 *   future Anthropic-Files / OpenAI Assistants research flows where the
 *   uploaded document_id is the source for a Citations or file-search call.
 *
 * @throws Error when `OPENAI_API_KEY` is missing or the upload fails (non-2xx).
 *
 * @example
 * ```ts
 * const bytes = await (await fetch(pdfUrl)).arrayBuffer();
 * const fileId = await uploadDocToOpenAI(env, {
 *   name: 'njsk-2024-annual-report.pdf',
 *   bytes,
 *   mime: 'application/pdf',
 * });
 * // → 'file_abc123'
 * ```
 *
 * @see https://platform.openai.com/docs/api-reference/files/create
 */
export async function uploadDocToOpenAI(
  env: Env,
  file: { name: string; bytes: ArrayBuffer | Uint8Array; mime: string },
): Promise<string> {
  if (!env.OPENAI_API_KEY) {
    throw new Error('uploadDocToOpenAI: OPENAI_API_KEY is not configured');
  }

  const blob = new Blob([file.bytes], { type: file.mime });
  const formData = new FormData();
  formData.append('purpose', 'assistants');
  formData.append('file', blob, file.name);

  const res = await fetch('https://api.openai.com/v1/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: formData,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI Files API error ${res.status}: ${text}`);
  }

  const data = (await res.json()) as { id: string };
  return data.id;
}
