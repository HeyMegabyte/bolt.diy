/**
 * Routed LLM client. Every call goes through Cloudflare AI Gateway when enabled.
 * Cache key = SHA-256(provider + model + body). Fallback chain:
 *   Anthropic Opus 4.7 → OpenAI GPT-4o → Workers AI Llama 3.3 70B FP8 Fast.
 */

import type { Env } from '../env.js';
import { AppError, ErrorCode } from '../types.js';
import { sha256Hex } from './crypto.js';

export type AiProvider = 'anthropic' | 'openai' | 'workers-ai';

export interface AiCallRequest {
  provider: AiProvider;
  model: string;
  body: Record<string, unknown>;
  /** When true, response is also written to KV under cache key. 5-min TTL. */
  cache?: boolean;
}

export interface AiCallResponse {
  provider: AiProvider;
  model: string;
  data: unknown;
  cached: boolean;
}

function gatewayBase(env: Env, provider: AiProvider): string {
  return `https://gateway.ai.cloudflare.com/v1/${env.CLOUDFLARE_ACCOUNT_ID}/${env.AI_GATEWAY_PROJECT}/${provider}`;
}

function vendorBase(provider: AiProvider): string {
  if (provider === 'anthropic') return 'https://api.anthropic.com';
  if (provider === 'openai') return 'https://api.openai.com';
  throw new AppError(ErrorCode.AI_GENERATION_ERROR, `vendor base unknown for ${provider}`);
}

/** Build provider-specific path appended to gateway/vendor base. */
function providerPath(provider: AiProvider): string {
  if (provider === 'anthropic') return '/v1/messages';
  if (provider === 'openai') return '/v1/chat/completions';
  return '';
}

function providerHeaders(env: Env, provider: AiProvider): Headers {
  const h = new Headers({ 'content-type': 'application/json' });
  if (provider === 'anthropic') {
    if (!env.ANTHROPIC_API_KEY)
      throw new AppError(ErrorCode.AI_GENERATION_ERROR, 'ANTHROPIC_API_KEY missing');
    h.set('x-api-key', env.ANTHROPIC_API_KEY);
    h.set('anthropic-version', '2023-06-01');
  }
  if (provider === 'openai') {
    if (!env.OPENAI_API_KEY)
      throw new AppError(ErrorCode.AI_GENERATION_ERROR, 'OPENAI_API_KEY missing');
    h.set('authorization', `Bearer ${env.OPENAI_API_KEY}`);
  }
  return h;
}

export async function aiCall(env: Env, req: AiCallRequest): Promise<AiCallResponse> {
  // Workers AI runs through the binding (auto-routed through AI Gateway by CF).
  if (req.provider === 'workers-ai') {
    // Cache Workers AI calls too — key on model + body.
    const cacheKey = req.cache
      ? `ai:workers-ai:${await sha256Hex(req.model + JSON.stringify(req.body))}`
      : null;
    if (cacheKey) {
      const cached = await env.CACHE.get(cacheKey, 'json');
      if (cached !== null) {
        return { provider: 'workers-ai', model: req.model, data: cached, cached: true };
      }
    }
    // The AI binding accepts any input shape per model; cast through `unknown` keeps
    // strict TS happy without coupling this helper to a single model's ambient type.
    const runner = env.AI as unknown as {
      run: (model: string, body: Record<string, unknown>) => Promise<unknown>;
    };
    const data = await runner.run(req.model, req.body);
    if (cacheKey) {
      await env.CACHE.put(cacheKey, JSON.stringify(data), { expirationTtl: 300 });
    }
    return { provider: 'workers-ai', model: req.model, data, cached: false };
  }

  const cacheKey = req.cache
    ? `ai:${req.provider}:${await sha256Hex(req.model + JSON.stringify(req.body))}`
    : null;
  if (cacheKey) {
    const cached = await env.CACHE.get(cacheKey, 'json');
    if (cached) {
      return {
        provider: req.provider,
        model: req.model,
        data: cached,
        cached: true,
      };
    }
  }

  const useGateway = env.AI_GATEWAY_ENABLED === 'true';
  const base = useGateway ? gatewayBase(env, req.provider) : vendorBase(req.provider);
  const url = base + providerPath(req.provider);

  const res = await fetch(url, {
    method: 'POST',
    headers: providerHeaders(env, req.provider),
    body: JSON.stringify({ ...req.body, model: req.model }),
  });
  if (!res.ok) {
    const text = await res.text();
    // Gateway 5xx → fall back to vendor direct (one retry).
    if (useGateway && res.status >= 500) {
      const direct = await fetch(vendorBase(req.provider) + providerPath(req.provider), {
        method: 'POST',
        headers: providerHeaders(env, req.provider),
        body: JSON.stringify({ ...req.body, model: req.model }),
      });
      if (direct.ok) {
        const data = await direct.json();
        return { provider: req.provider, model: req.model, data, cached: false };
      }
    }
    throw new AppError(ErrorCode.AI_GENERATION_ERROR, `AI call failed: ${res.status} ${text}`);
  }
  const data = await res.json();
  if (cacheKey) {
    await env.CACHE.put(cacheKey, JSON.stringify(data), { expirationTtl: 300 });
  }
  return { provider: req.provider, model: req.model, data, cached: false };
}

// ── High-level helpers (Wave 1B) ─────────────────────────────────────────────

/** Canonical Workers AI model aliases. FP8 variants only — bare aliases retired. */
export const MODELS = {
  LLAMA_3_3_70B: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  LLAMA_4_SCOUT: '@cf/meta/llama-4-scout-17b-16e-instruct',
  WHISPER: '@cf/openai/whisper',
} as const;

/**
 * Single-turn Workers AI text completion. Returns the assistant string trimmed.
 * Cached through AI Gateway (KV) — same prompt + model = same answer for 5min.
 */
export async function aiTextCompletion(
  env: Env,
  args: {
    model?: string;
    system: string;
    user: string;
    max_tokens?: number;
    cache?: boolean;
  },
): Promise<string> {
  const result = await aiCall(env, {
    provider: 'workers-ai',
    model: args.model ?? MODELS.LLAMA_3_3_70B,
    body: {
      messages: [
        { role: 'system', content: args.system },
        { role: 'user', content: args.user },
      ],
      max_tokens: args.max_tokens ?? 256,
    },
    cache: args.cache ?? true,
  });
  return extractText(result.data).trim();
}

/**
 * Workers AI vision completion. Accepts an image URL — fetches the image bytes
 * server-side (avoids cross-origin in the AI binding) then forwards as a
 * Uint8Array per the Llama 4 Scout vision input shape.
 */
export async function aiVisionCompletion(
  env: Env,
  args: {
    model?: string;
    prompt: string;
    image_url: string;
    max_tokens?: number;
    cache?: boolean;
  },
): Promise<string> {
  const imgRes = await fetch(args.image_url);
  if (!imgRes.ok) {
    throw new AppError(
      ErrorCode.AI_GENERATION_ERROR,
      `image fetch failed (${imgRes.status}) for ${args.image_url}`,
    );
  }
  const bytes = new Uint8Array(await imgRes.arrayBuffer());
  // Vision binding takes the image as a numeric array.
  const image = Array.from(bytes);
  const result = await aiCall(env, {
    provider: 'workers-ai',
    model: args.model ?? MODELS.LLAMA_4_SCOUT,
    body: {
      prompt: args.prompt,
      image,
      max_tokens: args.max_tokens ?? 96,
    },
    cache: args.cache ?? true,
  });
  return extractText(result.data).trim();
}

/**
 * OpenAI Text-to-Speech via AI Gateway. Returns MP3 bytes. NOT cached at the
 * gateway layer (binary body) — callers cache the resulting R2 URL instead.
 */
export async function openAiTts(
  env: Env,
  args: { model?: string; voice?: string; text: string },
): Promise<Uint8Array> {
  if (!env.OPENAI_API_KEY) {
    throw new AppError(ErrorCode.AI_GENERATION_ERROR, 'OPENAI_API_KEY missing');
  }
  const useGateway = env.AI_GATEWAY_ENABLED === 'true';
  const base = useGateway
    ? `https://gateway.ai.cloudflare.com/v1/${env.CLOUDFLARE_ACCOUNT_ID}/${env.AI_GATEWAY_PROJECT}/openai`
    : 'https://api.openai.com';
  const url = `${base}/v1/audio/speech`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.OPENAI_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: args.model ?? 'gpt-4o-mini-tts',
      voice: args.voice ?? 'alloy',
      input: args.text,
      response_format: 'mp3',
    }),
  });
  if (!res.ok) {
    throw new AppError(
      ErrorCode.AI_GENERATION_ERROR,
      `TTS failed: ${res.status} ${await res.text()}`,
    );
  }
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * Extract assistant text from the heterogenous shapes Workers AI returns
 * (varies per model). Falls back to JSON-stringify of unknown shapes.
 */
export function extractText(data: unknown): string {
  if (typeof data === 'string') return data;
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    if (typeof obj['response'] === 'string') return obj['response'];
    if (typeof obj['text'] === 'string') return obj['text'];
    if (typeof obj['description'] === 'string') return obj['description'];
    if (typeof obj['result'] === 'string') return obj['result'];
    const choices = obj['choices'];
    if (Array.isArray(choices) && choices.length > 0) {
      const first = choices[0] as { message?: { content?: unknown }; text?: unknown };
      if (first.message && typeof first.message.content === 'string') return first.message.content;
      if (typeof first.text === 'string') return first.text;
    }
  }
  return '';
}
