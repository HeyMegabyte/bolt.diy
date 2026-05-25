/**
 * Cost tracking + token estimation for chat input.
 *
 * @remarks
 *   Pure heuristic — no tiktoken WASM (avoid heavy client bundle).
 *   ~4 chars per token for English text, ~3.5 chars for code-heavy input.
 *   Per-model cost pulled from a static table mirroring Anthropic/OpenAI/Cloudflare 2026-05 pricing.
 *
 * @example
 *   const est = estimateCost('Refactor App.tsx', 'claude-opus-4-7');
 *   // { tokens: 5, costUsd: 0.000075, formatted: '~5 tokens · $0.0001' }
 */

export interface CostEstimate {
  tokens: number;
  costUsd: number;
  formatted: string;
  model: string;
}

interface ModelPricing {
  inputPer1M: number;
  outputPer1M: number;
}

// Per-million-token USD pricing (input rates only — completion cost is unknown at send time)
const PRICING_TABLE: Record<string, ModelPricing> = {
  // Anthropic
  'claude-opus-4-7': { inputPer1M: 15, outputPer1M: 75 },
  'claude-opus-4-6': { inputPer1M: 15, outputPer1M: 75 },
  'claude-sonnet-4-6': { inputPer1M: 3, outputPer1M: 15 },
  'claude-haiku-4-5': { inputPer1M: 1, outputPer1M: 5 },
  // OpenAI
  'gpt-4o': { inputPer1M: 2.5, outputPer1M: 10 },
  'gpt-4o-mini': { inputPer1M: 0.15, outputPer1M: 0.6 },
  'gpt-5': { inputPer1M: 12, outputPer1M: 36 },
  // Google
  'gemini-2.0-flash': { inputPer1M: 0.1, outputPer1M: 0.4 },
  'gemini-1.5-pro': { inputPer1M: 1.25, outputPer1M: 5 },
  // Workers AI pricing entries removed 2026-05-24 — provider no longer wired
  // into the editor surface. Worker-side (apps/project-sites/src/) still uses
  // env.AI bindings; that path is separate and unaffected.
};

const FALLBACK_PRICING: ModelPricing = { inputPer1M: 3, outputPer1M: 15 };

/**
 * Estimate token count using char-density heuristic.
 *
 * @remarks
 *   Tiktoken would be ~30KB WASM in the browser bundle. We avoid it.
 *   Code-heavy text packs ~3.5 chars/token; prose averages ~4.
 */
export function estimateTokens(text: string): number {
  if (!text) {
    return 0;
  }

  const codeChars = (text.match(/[{}\[\]<>;()/\\=]/g) || []).length;
  const isCode = codeChars / text.length > 0.04;
  const divisor = isCode ? 3.5 : 4;

  return Math.ceil(text.length / divisor);
}

export function getModelPricing(model: string): ModelPricing {
  return PRICING_TABLE[model] ?? FALLBACK_PRICING;
}

export function estimateCost(text: string, model = 'claude-sonnet-4-6'): CostEstimate {
  const tokens = estimateTokens(text);
  const pricing = getModelPricing(model);
  const costUsd = (tokens / 1_000_000) * pricing.inputPer1M;

  let formatted = '';

  if (tokens === 0) {
    formatted = '';
  } else if (costUsd < 0.0001) {
    formatted = `~${tokens.toLocaleString()} tokens · <$0.0001`;
  } else if (costUsd < 0.01) {
    formatted = `~${tokens.toLocaleString()} tokens · $${costUsd.toFixed(4)}`;
  } else {
    formatted = `~${tokens.toLocaleString()} tokens · $${costUsd.toFixed(3)}`;
  }

  return { tokens, costUsd, formatted, model };
}
