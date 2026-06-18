/**
 * @module libs/features/model_registry/schemas
 * @description Zod contracts for the model-registry feature — the OpenAI-compatible
 * list response shape and individual ModelEntry objects.
 */
import { z } from 'zod';

/** Capabilities booleans reported per alias in the list response. */
export const ModelCapabilitiesSchema = z.object({
  chat: z.boolean(),
  vision: z.boolean(),
  embeddings: z.boolean(),
  tools: z.boolean(),
  streaming: z.boolean(),
});
export type ModelCapabilities = z.infer<typeof ModelCapabilitiesSchema>;

/**
 * A single model entry in the OpenAI-compatible list response.
 * `created: 0` is intentional — deterministic for tests.
 */
export const ModelEntrySchema = z.object({
  /** Model alias id (e.g. "edge-fast", "claude-architect"). */
  id: z.string(),
  /** Always "model" per OpenAI spec. */
  object: z.literal('model'),
  /** Unix timestamp. Set to 0 for determinism (no external calls). */
  created: z.literal(0),
  owned_by: z.literal('projectsites'),
  /** Provider tier of the alias (first provider's tier). */
  _tier: z.string(),
  /** List of provider ids this alias can route to. */
  _providers: z.array(z.string()),
  /** Combined capabilities of the alias. */
  _capabilities: ModelCapabilitiesSchema,
  /** Whether at least one provider in the alias's list has its env keys configured. */
  _available: z.boolean(),
});
export type ModelEntry = z.infer<typeof ModelEntrySchema>;

/** OpenAI-compatible list response from GET /v1/models. */
export const ModelsListResponseSchema = z.object({
  object: z.literal('list'),
  data: z.array(ModelEntrySchema),
});
export type ModelsListResponse = z.infer<typeof ModelsListResponseSchema>;
