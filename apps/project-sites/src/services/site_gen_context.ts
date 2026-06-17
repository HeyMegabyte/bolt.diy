/**
 * Site-generation context pipeline — pure assembly and merge of all inputs
 * into a single, Zod-validated {@link GenerationContext}.
 *
 * @remarks
 * Precedence for the `business` object (later wins per key):
 *   leadResearch < placesData < createForm < edits
 *
 * `brand` is kept as a separate top-level field so style/identity information
 * does not bleed into the business-data merge.
 *
 * `seoKeywords` are deduped and lower-cased so downstream prompt renderers do
 * not have to normalise them.
 *
 * `sources` records which input keys were present (non-undefined) so the
 * caller can trace where the context came from without inspecting every field.
 *
 * Every path NEVER throws — `assembleGenerationContext` returns a typed result
 * that the caller can forward directly to the AI workflow step.
 *
 * @example
 * ```ts
 * const ctx = assembleGenerationContext({
 *   leadResearch: research,
 *   placesData: places,
 *   createForm: form,
 *   edits: userEdits,
 *   brand: brandTokens,
 *   seoKeywords: ['pizza newark nj', 'best pizza newark'],
 * });
 * // ctx.business has all fields merged with edits taking precedence.
 * ```
 *
 * @throws Never — all errors are swallowed; the Zod schema parse uses
 * `safeParse` internally and falls back to safe defaults.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

/** Input accepted by {@link assembleGenerationContext}. */
const AssembleInputSchema = z.object({
  leadResearch: z.record(z.string(), z.unknown()).optional(),
  placesData: z.record(z.string(), z.unknown()).optional(),
  createForm: z.record(z.string(), z.unknown()).optional(),
  edits: z.record(z.string(), z.unknown()).optional(),
  brand: z.record(z.string(), z.unknown()).optional(),
  seoKeywords: z.array(z.string()).optional(),
});

/** Output of {@link assembleGenerationContext}. */
const GenerationContextSchema = z.object({
  /** Merged business-data fields, with edits having the highest precedence. */
  business: z.record(z.string(), z.unknown()),
  /** Brand / design tokens passed through without merging into business. */
  brand: z.record(z.string(), z.unknown()),
  /** Deduped, lowercased SEO keywords. */
  seoKeywords: z.array(z.string()),
  /** Which input keys were provided (non-undefined) to produce this context. */
  sources: z.array(z.string()),
});

/** Validated generation context forwarded to the AI workflow step. */
export type GenerationContext = z.infer<typeof GenerationContextSchema>;

/** Accepted input shape for {@link assembleGenerationContext}. */
export type AssembleInput = z.infer<typeof AssembleInputSchema>;

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Assemble and merge all site-generation inputs into a single
 * {@link GenerationContext}.
 *
 * @param input - Raw inputs from research, Places API, the create form, and
 *   manual edits.  All fields are optional; an empty object is valid and
 *   returns an empty-but-valid context.
 * @returns A Zod-validated {@link GenerationContext}; never throws.
 *
 * @see {@link GenerationContext}
 */
export function assembleGenerationContext(input: AssembleInput): GenerationContext {
  // Validate input defensively — fall back to empty object on bad input.
  const parsed = AssembleInputSchema.safeParse(input);
  const safe = parsed.success ? parsed.data : {};

  const { leadResearch, placesData, createForm, edits, brand, seoKeywords } = safe;

  // -- Business merge (low → high precedence) --------------------------------
  const business: Record<string, unknown> = {
    ...(leadResearch ?? {}),
    ...(placesData ?? {}),
    ...(createForm ?? {}),
    ...(edits ?? {}),
  };

  // -- Brand passthrough ------------------------------------------------------
  const brandOut: Record<string, unknown> = { ...(brand ?? {}) };

  // -- seoKeywords: lowercase + dedupe ----------------------------------------
  const keywordsOut: string[] = [];
  if (seoKeywords !== undefined) {
    const seen = new Set<string>();
    for (const kw of seoKeywords) {
      const lower = kw.toLowerCase();
      if (!seen.has(lower)) {
        seen.add(lower);
        keywordsOut.push(lower);
      }
    }
  }

  // -- Sources: which input keys were provided ---------------------------------
  const sources: string[] = [];
  if (leadResearch !== undefined) sources.push('leadResearch');
  if (placesData !== undefined) sources.push('placesData');
  if (createForm !== undefined) sources.push('createForm');
  if (edits !== undefined) sources.push('edits');
  if (brand !== undefined) sources.push('brand');
  if (seoKeywords !== undefined) sources.push('seoKeywords');

  // -- Final Zod validation ---------------------------------------------------
  const result = GenerationContextSchema.safeParse({
    business,
    brand: brandOut,
    seoKeywords: keywordsOut,
    sources,
  });

  if (result.success) {
    return result.data;
  }

  // Fallback: return safe empty context (should never happen given the logic above).
  return {
    business: {},
    brand: {},
    seoKeywords: [],
    sources: [],
  };
}
