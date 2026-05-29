/**
 * @module libs/features/ai_components/schemas
 * @description Zod schemas for the AI Code Components Generator (IDEAS-50 #42).
 *
 * Describe a widget in plain language → get a production React TSX component
 * scaffolded with the site's brand tokens (palette / fonts / tone) auto-inherited
 * from `_brand.json`. Generated components can be promoted to the plugin
 * marketplace as reusable items.
 *
 * @packageDocumentation
 */

import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────────
// Brand-token snapshot — the slice of `_brand.json` we inject into the prompt.
// ─────────────────────────────────────────────────────────────────────────────

export const BrandTokensSnapshotSchema = z.object({
  palette: z.record(z.string(), z.string()).optional(),
  fonts: z
    .object({
      heading: z.string().optional(),
      body: z.string().optional(),
      logo: z.string().optional(),
    })
    .optional(),
  tone: z.string().optional(),
  voice: z.string().optional(),
  personality: z.string().optional(),
  theme: z.enum(['light', 'dark']).optional(),
});

export type BrandTokensSnapshot = z.infer<typeof BrandTokensSnapshotSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Generation request — the natural-language description from the user.
// ─────────────────────────────────────────────────────────────────────────────

export const GenerateComponentInputSchema = z.object({
  site_id: z.string().min(1),
  /** Natural-language description of the widget the user wants. */
  description: z
    .string()
    .min(10, 'description must be at least 10 chars')
    .max(2_000, 'description must be at most 2000 chars'),
  /** Optional short component name override (PascalCase). */
  name: z
    .string()
    .regex(/^[A-Z][A-Za-z0-9]*$/, 'name must be PascalCase')
    .max(80)
    .optional(),
});

export type GenerateComponentInput = z.infer<typeof GenerateComponentInputSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Generation output — the contract the AI must satisfy.
// ─────────────────────────────────────────────────────────────────────────────

export const ComponentStatusSchema = z.enum(['draft', 'published', 'archived']);
export type ComponentStatus = z.infer<typeof ComponentStatusSchema>;

export const GeneratedComponentSchema = z.object({
  /** PascalCase identifier the component is exported as. */
  name: z.string().regex(/^[A-Z][A-Za-z0-9]*$/, 'name must be PascalCase'),
  /** React TSX source — must contain `export default function <name>(...)`. */
  component_code: z.string().min(50).max(50_000),
  /** Plain-English summary of what the component does. */
  description: z.string().min(10).max(500),
});

export type GeneratedComponent = z.infer<typeof GeneratedComponentSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Persistence row shape.
// ─────────────────────────────────────────────────────────────────────────────

export const AiComponentRowSchema = z.object({
  id: z.string(),
  site_id: z.string(),
  org_id: z.string(),
  created_by: z.string(),
  name: z.string(),
  description: z.string(),
  component_code: z.string(),
  brand_tokens_snapshot: z.string(),
  ai_model: z.string(),
  ai_tokens: z.number().nullable().optional(),
  status: ComponentStatusSchema,
  published_to_marketplace: z.number().int().min(0).max(1),
  marketplace_plugin_id: z.string().nullable().optional(),
  generation_count: z.number().int().nonnegative(),
  created_at: z.string(),
  updated_at: z.string().nullable().optional(),
});

export type AiComponentRow = z.infer<typeof AiComponentRowSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Publish-to-marketplace input.
// ─────────────────────────────────────────────────────────────────────────────

export const PublishComponentInputSchema = z.object({
  component_id: z.string().min(1),
  /** Optional price; 0 = free, ≥100 = paid. */
  price_cents: z.number().int().min(0).max(50_000).default(0),
  /** Marketplace category. */
  category: z.string().min(2).max(40).default('other'),
});

export type PublishComponentInput = z.infer<typeof PublishComponentInputSchema>;
