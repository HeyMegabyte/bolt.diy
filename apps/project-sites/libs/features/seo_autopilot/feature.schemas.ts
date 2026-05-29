/**
 * @module libs/features/seo_autopilot/schemas
 * @description Zod schemas for the SEO/GEO Autopilot feature module (idea #23).
 *
 * Single source of truth for the runtime shapes the service + routes exchange.
 * Length bounds here MIRROR the SEO Hard Gates in `apps/project-sites/CLAUDE.md`:
 *   - `<title>`            50-60 chars
 *   - `<meta description>` 120-156 chars
 *   - quotable answer block 40-60 words (AI-search/GEO citation surface)
 *
 * The service enforces these bounds in code (truncate/validate) BEFORE the data
 * reaches these schemas, so a parse() failure here means a genuine bug upstream.
 *
 * @packageDocumentation
 */

import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────────
// Length constants — keep in lockstep with build_validators.ts meta gates.
// ─────────────────────────────────────────────────────────────────────────────

export const TITLE_MIN = 50;
export const TITLE_MAX = 60;
export const DESCRIPTION_MIN = 120;
export const DESCRIPTION_MAX = 156;
export const ANSWER_WORDS_MIN = 40;
export const ANSWER_WORDS_MAX = 60;

/** Count words the same way the service does — split on runs of whitespace. */
export function countWords(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  return trimmed.split(/\s+/).length;
}

// ─────────────────────────────────────────────────────────────────────────────
// Core output — generated SEO/GEO meta for a single route.
// ─────────────────────────────────────────────────────────────────────────────

export const SeoMetaSchema = z.object({
  /** SEO `<title>` — 50-60 chars (clamped by the service). */
  title: z.string().min(TITLE_MIN).max(TITLE_MAX),
  /** `<meta name="description">` — 120-156 chars (clamped by the service). */
  description: z.string().min(DESCRIPTION_MIN).max(DESCRIPTION_MAX),
  /**
   * Quotable answer block — 40-60 words, tuned for AI-search engines
   * (ChatGPT / Perplexity / Google AI Overviews) to lift verbatim as a citation.
   */
  answerBlock: z
    .string()
    .refine((v) => countWords(v) >= ANSWER_WORDS_MIN, {
      message: `answerBlock must be at least ${ANSWER_WORDS_MIN} words`,
    })
    .refine((v) => countWords(v) <= ANSWER_WORDS_MAX, {
      message: `answerBlock must be at most ${ANSWER_WORDS_MAX} words`,
    }),
});

export type SeoMeta = z.infer<typeof SeoMetaSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// JSON-LD — schema.org structured data. WebPage is the floor; FAQPage only when
// real Q&A is supplied. NEVER fabricate schema types.
// ─────────────────────────────────────────────────────────────────────────────

/** A single real FAQ entry. Both fields must be non-empty to emit FAQPage. */
export const FaqEntrySchema = z.object({
  question: z.string().min(1),
  answer: z.string().min(1),
});

export type FaqEntry = z.infer<typeof FaqEntrySchema>;

/** Allowed JSON-LD kinds the autopilot will request. */
export const JsonLdKindSchema = z.enum(['WebPage', 'FAQPage']);
export type JsonLdKind = z.infer<typeof JsonLdKindSchema>;

/** Input to buildJsonLd — `faqs` only ever populated with REAL Q&A. */
export const BuildJsonLdInputSchema = z.object({
  siteId: z.string().min(1),
  route: z.string().min(1),
  kind: JsonLdKindSchema.default('WebPage'),
  name: z.string().optional(),
  description: z.string().optional(),
  faqs: z.array(FaqEntrySchema).default([]),
});

export type BuildJsonLdInput = z.infer<typeof BuildJsonLdInputSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Draft persistence — pending → approved/rejected approval workflow.
// ─────────────────────────────────────────────────────────────────────────────

export const SeoDraftStatusSchema = z.enum(['pending', 'approved', 'rejected', 'applied']);
export type SeoDraftStatus = z.infer<typeof SeoDraftStatusSchema>;

export const SeoMetaDraftSchema = z.object({
  id: z.string(),
  site_id: z.string(),
  org_id: z.string().nullable().optional(),
  route: z.string(),
  title: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  answer_block: z.string().nullable().optional(),
  jsonld_json: z.string().nullable().optional(),
  status: SeoDraftStatusSchema,
  ai_model: z.string().nullable().optional(),
  ai_tokens: z.number().nullable().optional(),
  approved_by: z.string().nullable().optional(),
  approved_at: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
});

export type SeoMetaDraft = z.infer<typeof SeoMetaDraftSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Route bodies.
// ─────────────────────────────────────────────────────────────────────────────

/** A route to process during `freshenSite`. */
export const FreshenRouteSchema = z.object({
  route: z.string().min(1),
  pageText: z.string().default(''),
  faqs: z.array(FaqEntrySchema).default([]),
});

export type FreshenRoute = z.infer<typeof FreshenRouteSchema>;

/** POST /:siteId/freshen body — optional explicit route list. */
export const FreshenSiteBodySchema = z.object({
  routes: z.array(FreshenRouteSchema).optional(),
});

export type FreshenSiteBody = z.infer<typeof FreshenSiteBodySchema>;

export const GenerateSeoMetaInputSchema = z.object({
  siteId: z.string().min(1),
  route: z.string().min(1),
  pageText: z.string().default(''),
});

export type GenerateSeoMetaInput = z.infer<typeof GenerateSeoMetaInputSchema>;
