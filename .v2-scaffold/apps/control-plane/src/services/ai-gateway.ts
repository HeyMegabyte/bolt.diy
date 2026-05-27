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
    const data = await env.AI.run(
      req.model as keyof AiModels,
      req.body as Ai_Cf_Meta_Llama_3_3_70B_Instruct_Fp8_Fast_Input,
    );
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
