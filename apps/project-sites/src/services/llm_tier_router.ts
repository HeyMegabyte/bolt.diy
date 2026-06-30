/**
 * @module services/llm_tier_router
 * @description LOOP-LLM-002 core — tier-routing primitive that selects the
 * cheapest-viable LLM provider tier for a given request. Pure function, zero I/O.
 *
 * Tiers map to [[model-routing]]:
 * - `instant` → Workers AI (free, edge, sub-ms latency — reflexes)
 * - `standard` → DeepSeek (mid-grade, volume)
 * - `premium` → Anthropic/OpenAI (judgment, vision)
 *
 * @packageDocumentation
 */

import { z } from 'zod';

// ── Tiers ──────────────────────────────────────────────────────────────────

export const LlmTier = z.enum(['instant', 'standard', 'premium']);
export type LlmTier = z.infer<typeof LlmTier>;

// ── Task classification ────────────────────────────────────────────────────

/** Known task categories that map to LLM tiers. */
export const LlmTaskCategory = z.enum([
  'classification',
  'embedding',
  'moderation',
  'extraction',
  'summarization',
  'translation',
  'generation',
  'code_generation',
  'reasoning',
  'planning',
  'vision',
  'security_review',
  'architecture',
]);
export type LlmTaskCategory = z.infer<typeof LlmTaskCategory>;

// ── Routing input ──────────────────────────────────────────────────────────

export const TierRoutingInputSchema = z.object({
  /** The LLM task being performed. */
  task: LlmTaskCategory,
  /** Whether this request is latency-sensitive (sub-1s response needed). */
  latencySensitive: z.boolean().default(false),
  /** Whether the model must support vision/image inputs. */
  requiresVision: z.boolean().default(false),
  /** Estimated input token count (for cost-sensitive routing). */
  estimatedTokens: z.number().int().positive().default(1000),
  /** Whether this is a user-facing synchronous request. */
  userFacing: z.boolean().default(false),
  /** Whether the provider must be open-source (for AGPL/OSS compliance). */
  requireOpenSource: z.boolean().default(false),
});
export type TierRoutingInput = z.infer<typeof TierRoutingInputSchema>;

// ── Routing output ─────────────────────────────────────────────────────────

export const TierRoutingResultSchema = z.object({
  /** The selected tier. */
  tier: LlmTier,
  /** Human-readable reason for the selection. */
  reason: z.string(),
  /** Whether the tier can be downgraded under quota pressure. */
  downgradable: z.boolean(),
  /** Fallback tier if the primary is unavailable. */
  fallback: LlmTier,
});
export type TierRoutingResult = z.infer<typeof TierRoutingResultSchema>;

// ── Fixed routing table ────────────────────────────────────────────────────

/** Default tier per task category. */
const TASK_TIER: Record<LlmTaskCategory, LlmTier> = {
  classification: 'instant',
  embedding: 'instant',
  moderation: 'instant',
  extraction: 'standard',
  summarization: 'standard',
  translation: 'standard',
  generation: 'standard',
  code_generation: 'standard',
  reasoning: 'premium',
  planning: 'premium',
  vision: 'premium',
  security_review: 'premium',
  architecture: 'premium',
};

/** Tasks that are safe to downgrade under quota pressure. */
const DOWNGRADABLE_TASKS: Set<LlmTaskCategory> = new Set([
  'summarization',
  'generation',
  'code_generation',
  'extraction',
  'translation',
]);

// ── Route ──────────────────────────────────────────────────────────────────

/**
 * Selects the cheapest-viable LLM tier for a given task. Pure — same inputs
 * always produce the same tier.
 *
 * Routing rules (ordered — first match wins):
 * 1. Vision-required → `premium` (only Anthropic/GPT-4o has vision)
 * 2. Latency-sensitive + user-facing → `instant` (Workers AI, no network hop)
 * 3. Open-source required → `instant` (Workers AI Llama, no proprietary vendor)
 * 4. Fall through to the task-category default table
 *
 * @param input - Task classification and constraints.
 * @returns The selected tier with reasoning and fallback.
 *
 * @example
 * ```ts
 * const route = routeLlmTier({ task: 'classification', latencySensitive: true, userFacing: true });
 * // { tier: 'instant', reason: 'Latency-sensitive user-facing classification → instant (Workers AI)', ... }
 * ```
 */
export function routeLlmTier(input: TierRoutingInput): TierRoutingResult {
  const parsed = TierRoutingInputSchema.parse(input);

  // Vision is only available on premium tier
  if (parsed.requiresVision) {
    return result('premium', 'Vision/image input required — only premium tier supports it', false);
  }

  // Latency-sensitive user-facing → instant (edge inference)
  if (parsed.latencySensitive && parsed.userFacing) {
    return result(
      'instant',
      `Latency-sensitive user-facing ${parsed.task} → instant (Workers AI edge)`,
      true,
    );
  }

  // Open-source required → instant (Workers AI Llama models)
  if (parsed.requireOpenSource) {
    return result(
      'instant',
      `Open-source requirement for ${parsed.task} → instant (Workers AI Llama)`,
      true,
    );
  }

  // Default: task-category routing table
  const tier = TASK_TIER[parsed.task];
  const downgradable = DOWNGRADABLE_TASKS.has(parsed.task);
  return result(tier, `${parsed.task} → ${tier} (task-category default)`, downgradable);
}

// ── Internal helpers ───────────────────────────────────────────────────────

function result(tier: LlmTier, reason: string, downgradable: boolean): TierRoutingResult {
  const fallback: LlmTier =
    tier === 'premium' ? 'standard' : tier === 'standard' ? 'instant' : 'instant';

  return TierRoutingResultSchema.parse({ tier, reason, downgradable, fallback });
}
