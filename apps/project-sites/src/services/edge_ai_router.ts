/**
 * Edge AI Router — the FIRST decision every AI request makes.
 *
 * The product promise (marketing homepage): "instant responses via Workers AI
 * (free), routine generation via DeepSeek, premium reasoning via Anthropic
 * Claude or OpenAI." This module makes that promise real at the edge:
 *
 *   1. `classifyPromptTier()` — deterministic, sub-ms classification (no LLM
 *      call, no external latency) into `instant` / `standard` / `premium`.
 *      A model-name hint (what the client asked for) wins; then explicit
 *      reasoning markers; then build/code markers; short chit-chat falls to
 *      `instant`.
 *   2. `instant` → Workers AI (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`,
 *      streamed, FREE at the edge) — never leaves Cloudflare.
 *   3. `standard` → DeepSeek through the Cloudflare AI Gateway (OpenAI-compat
 *      `chat/completions`, `stream:true`).
 *   4. `premium` → OpenAI `gpt-4o` through the AI Gateway (OpenAI-compat).
 *      (Anthropic-via-gateway uses its native wire format and belongs to
 *      Anthropic-protocol surfaces, not this OpenAI-compat pass-through.)
 *
 * The gateway is CONDITIONAL per the standing contract: used whenever
 * `CF_ACCOUNT_ID` is set and `AI_GATEWAY_ENABLED !== "false"`; a gateway 5xx
 * falls back to the provider's direct URL inside {@link gatewayFetch}.
 *
 * Output is always OpenAI-compatible SSE (`data: {"choices":[...]}` frames +
 * `data: [DONE]`) so AI SDK clients (the bolt editor) consume it unchanged.
 */

import type { Env } from '../types/env.js';
import { chooseProviderForTier } from './external_llm.js';
import { gatewayFetch } from './ai_gateway.js';

export type AiTier = 'instant' | 'standard' | 'premium';

/** Workers AI model for instant answers (free tier, streaming). */
const INSTANT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast' as const;

/**
 * Chat models per provider + tier (all OpenAI-compat wire format). When a
 * tier's preferred provider lacks its key, `chooseProviderForTier` falls back
 * to OpenAI — the models below cover both providers at both tiers.
 */
const TIER_MODELS: Record<'deepseek' | 'openai', Record<Exclude<AiTier, 'instant'>, string>> = {
  deepseek: { standard: 'deepseek-chat', premium: 'deepseek-reasoner' },
  openai: { standard: 'gpt-4o-mini', premium: 'gpt-4o' },
};

/** Model-name hints the bolt editor sends → tier (its static model chips). */
const MODEL_HINT_TIER: Record<string, AiTier> = {
  'claude-opus-4-6': 'premium',
  'claude-sonnet-4-6': 'premium',
  'deepseek-chat': 'standard',
  'deepseek-reasoner': 'premium',
  'glm-4.6': 'standard',
};

/** Reasoning-intent markers → premium (checked BEFORE build markers). */
const PREMIUM_MARKERS = [
  /\b(architecture|refactor|design system|step by step|algorithm|proof|optimize|migrate)\b/,
  /\b(analy[sz]e|evaluate|compare|critique|reason|explain how|explain why)\b/,
  /\b(plan|strategy|trade-?offs|root cause|security audit)\b/,
  /\b(math|calculus|derivative|integral|logic puzzle|proof that)\b/,
];

/** Build/code markers → standard (DeepSeek generation tier). */
const STANDARD_MARKERS = [
  /\b(build|create|generate|write|implement|fix|add|update|remove)\b/,
  /\b(code|component|page|section|component|function|app|site|website|api|endpoint)\b/,
  /\b(html|css|javascript|typescript|react|angular|tailwind|sql|database|deploy)\b/,
  /```/,
];

/** Extract the last user turn's text (ignore tool/system scaffolding). */
function lastUserText(messages: { role: string; content: string }[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role === 'user' && typeof m.content === 'string' && m.content.trim()) {
      return m.content;
    }
  }
  return '';
}

/**
 * Classify a prompt into the cheapest tier that can answer it well — at the
 * edge, deterministically, in sub-ms (no LLM round-trip for routing).
 *
 * @param messages - OpenAI-format conversation (the last user turn is scored).
 * @param modelHint - Optional model name the client asked for (bolt chips).
 * @returns `instant` (Workers AI) · `standard` (DeepSeek via gateway) ·
 *   `premium` (OpenAI via gateway).
 * @example classifyPromptTier([{ role: 'user', content: 'What is 2+2?' }]) // 'instant'
 * @example classifyPromptTier([{ role: 'user', content: 'Build a hero section with Tailwind' }]) // 'standard'
 */
export function classifyPromptTier(
  messages: { role: string; content: string }[],
  modelHint?: string | null,
): AiTier {
  // Explicit client intent wins (the model chip the user picked).
  if (modelHint && MODEL_HINT_TIER[modelHint]) return MODEL_HINT_TIER[modelHint]!;

  const text = lastUserText(messages);
  const lower = text.toLowerCase();

  // Long or reasoning-shaped → premium. Checked FIRST: a long build request
  // with deep intent is premium, not standard.
  if (text.length > 800 || PREMIUM_MARKERS.some((re) => re.test(lower))) return 'premium';

  // Build/code intent → standard (DeepSeek is the volume generator).
  if (STANDARD_MARKERS.some((re) => re.test(lower))) return 'standard';

  // Anything else (short Q&A, chit-chat, definitions) → instant, free, edge.
  return 'instant';
}

/** Map a model hint directly to a tier without heuristics. */
export function tierFromModelHint(modelHint?: string | null): AiTier | null {
  if (modelHint && MODEL_HINT_TIER[modelHint]) return MODEL_HINT_TIER[modelHint]!;
  return null;
}

/** JSON-escape a string for embedding in an SSE `data:` frame. */
function sseEscape(s: string): string {
  return JSON.stringify(s).slice(1, -1);
}

/**
 * Stream a Workers AI answer as OpenAI-compatible SSE frames, so OpenAI-SDK
 * clients consume it unchanged. Never throws — errors become an error frame.
 */
async function workersAiToOpenAiSse(
  env: Env,
  messages: { role: string; content: string }[],
): Promise<Response> {
  let stream: ReadableStream<string> | null = null;
  try {
    const ai = env.AI as unknown as {
      run: (model: string, opts: unknown) => Promise<ReadableStream<string>>;
    };
    stream = await ai.run(INSTANT_MODEL, { messages, stream: true, max_tokens: 1024 });
  } catch (err) {
    return new Response(
      `data: {"error":{"code":"INSTANT_AI_FAILED","message":"Workers AI unavailable"}}\n\ndata: [DONE]\n\n`,
      { status: 200, headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } },
    );
  }

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      let sawDone = false;
      try {
        // Workers AI stream chunks are read via the reader (not typed
        // async-iterable — same pattern as the palette in ai_admin.ts).
        // They arrive in one of TWO shapes, so the shim handles both:
        //   • OpenAI-format SSE frames (`data: {"choices":[...]}`) — some
        //     Workers AI chat streams return these VERBATIM; wrapping them
        //     again double-encodes and breaks AI SDK clients (live-incident:
        //     the editor bounced to its landing screen on nested `data:`).
        //   • raw text deltas — wrapped into an OpenAI delta frame here.
        const reader = stream!.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const text = (typeof value === 'string' ? value : new TextDecoder().decode(value)).trim();
          if (!text) continue;
          if (text.includes('[DONE]')) sawDone = true;
          if (text.startsWith('data:')) {
            controller.enqueue(encoder.encode(`${text}\n\n`));
          } else {
            const frame = `data: {"id":"wa","choices":[{"delta":{"content":"${sseEscape(text)}"}}]}\n\n`;
            controller.enqueue(encoder.encode(frame));
          }
        }
        if (!sawDone) controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      } catch {
        controller.enqueue(
          encoder.encode(
            `data: {"error":{"code":"INSTANT_AI_FAILED","message":"Stream interrupted"}}\n\ndata: [DONE]\n\n`,
          ),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      'X-Edge-Tier': 'instant',
    },
  });
}

/**
 * Route a bolt-chat request: classify at the edge → Workers AI when instant,
 * else the tier model through the (conditional) Cloudflare AI Gateway.
 *
 * @param env - Worker env (AI binding + CF_ACCOUNT_ID + provider keys).
 * @param messages - OpenAI-format conversation.
 * @param modelHint - Client's model name (bolt model chip) as a tier hint.
 * @returns OpenAI-compatible SSE `Response` (always 200 unless upstream dies).
 */
export async function routeBoltChat(
  env: Env,
  messages: { role: string; content: string }[],
  modelHint?: string | null,
): Promise<Response> {
  const tier = tierFromModelHint(modelHint) ?? classifyPromptTier(messages, modelHint);

  if (tier === 'instant') {
    return workersAiToOpenAiSse(env, messages);
  }

  const provider = chooseProviderForTier(env, tier);
  if (provider === 'anthropic') {
    // This surface speaks the OpenAI chat/completions wire format; Anthropic's
    // native protocol is not wire-compatible. premium → OpenAI via gateway.
    const upstream = await gatewayFetch(env, 'openai', '/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: TIER_MODELS.openai.premium, messages, stream: true }),
    });
    return gatewayResponse(upstream, tier);
  }

  const gatewayProvider: 'deepseek' | 'openai' = provider === 'deepseek' ? 'deepseek' : 'openai';
  const upstream = await gatewayFetch(env, gatewayProvider, '/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: TIER_MODELS[gatewayProvider][tier],
      messages,
      stream: true,
    }),
  });
  return gatewayResponse(upstream, tier);
}

/** Wrap a gatewayFetch result as the SSE response (502 JSON on upstream failure). */
function gatewayResponse(
  upstream: Awaited<ReturnType<typeof gatewayFetch>>,
  tier: Exclude<AiTier, 'instant'>,
): Response {
  if (!upstream.response.ok) {
    return Response.json(
      { error: 'upstream_error', status: upstream.response.status },
      { status: 502 },
    );
  }
  return new Response(upstream.response.body, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      'X-AI-Gateway': upstream.gatewayUsed ? '1' : '0',
      'X-Edge-Tier': tier,
    },
  });
}
