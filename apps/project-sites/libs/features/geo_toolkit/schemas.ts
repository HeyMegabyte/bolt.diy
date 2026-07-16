/**
 * @module libs/features/geo_toolkit/schemas
 *
 * Zod schemas for GEO (Generative Engine Optimization) Toolkit (#46, ROI 3.24).
 * Analyzes content for AI answer engine discoverability — dual-scoring for
 * traditional SEO + AI platforms (ChatGPT, Gemini, Perplexity, Google AI Overviews).
 */
import { z } from 'zod';

export const GeoScoreSchema = z.object({
  /** Overall GEO score 0-100. */
  overall: z.number().min(0).max(100),
  /** Traditional SEO score 0-100. */
  seoScore: z.number().min(0).max(100),
  /** AI answer engine visibility score 0-100. */
  aiScore: z.number().min(0).max(100),
  /** Grade: A+ through F. */
  grade: z.enum(['A+', 'A', 'B', 'C', 'D', 'F']),
});

export type GeoScore = z.infer<typeof GeoScoreSchema>;

export const FactualClaimSchema = z.object({
  text: z.string(),
  category: z.enum(['statistic', 'price', 'date', 'claim', 'comparison', 'guarantee']),
  cited: z.boolean(),
  sourceHint: z.string().optional(),
});

export type FactualClaim = z.infer<typeof FactualClaimSchema>;

export const GeoAnalysisSchema = z.object({
  url: z.string(),
  analyzedAt: z.string(),
  geoScore: GeoScoreSchema,
  factualClaims: z.array(FactualClaimSchema),
  citedClaims: z.number().int().nonnegative(),
  uncitedClaims: z.number().int().nonnegative(),
  suggestions: z.array(z.object({
    priority: z.enum(['critical', 'high', 'medium', 'low']),
    title: z.string(),
    description: z.string(),
    impact: z.enum(['ai_visibility', 'trust', 'seo', 'completeness']),
  })),
  aiFormattingScore: z.number().min(0).max(100),
  structuredDataPresent: z.boolean(),
  faqSchemaPresent: z.boolean(),
});

export type GeoAnalysis = z.infer<typeof GeoAnalysisSchema>;

export const GeoAnalysisRequestSchema = z.object({
  url: z.string().url(),
  content: z.string().min(1),
  existingJsonLd: z.array(z.string()).optional().default([]),
});
