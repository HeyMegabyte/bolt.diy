import type { Env } from '../../../src/types/env.js';
import type { GuardrailCheckResponse } from './schemas.js';

export const FLAG_KEY = 'ai_gateway_guardrails';
const GUARD_MODEL = '@cf/meta/llama-guard-3-8b';
const DEFAULT_THRESHOLD = 0.85;

interface LlamaGuardResult {
  response?: string;
  safe?: boolean;
  label?: string;
  score?: number;
}

export async function classify(
  env: Env,
  text: string,
  threshold = DEFAULT_THRESHOLD,
): Promise<GuardrailCheckResponse> {
  try {
    const ai = env.AI as { run: (model: string, params: { messages: { role: string; content: string }[] }) => Promise<LlamaGuardResult> };
    const result = await ai.run(GUARD_MODEL, {
      messages: [{ role: 'user', content: text }],
    });

    const rawSafe = result.safe ?? (result.response?.toLowerCase().includes('safe') ?? true);
    const score = result.score ?? (rawSafe ? 0.1 : 0.9);
    const category = result.label ?? null;
    const blocked = !rawSafe && score >= threshold;

    return { safe: rawSafe, score, category, blocked };
  } catch {
    // Fail open: if the guard model is unavailable, allow the request
    return { safe: true, score: 0, category: null, blocked: false };
  }
}

/** Convenience helper for other modules to guard AI inputs inline. */
export async function guardText(
  env: Env,
  text: string,
  threshold = DEFAULT_THRESHOLD,
): Promise<{ allowed: boolean; reason?: string }> {
  const result = await classify(env, text, threshold);
  if (result.blocked) {
    return { allowed: false, reason: result.category ?? 'unsafe_content' };
  }
  return { allowed: true };
}
