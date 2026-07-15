/**
 * @module libs/features/ai_site_critic/schemas
 *
 * Zod schemas for the AI Website Critic — structured site critique with
 * per-dimension scores, prioritized fixes, and industry benchmarking.
 */
import { z } from 'zod';

export const CriticDimensionSchema = z.object({
  name: z.enum(['layout', 'typography', 'color', 'imagery', 'whitespace', 'distinctiveness', 'trust', 'copy', 'seo', 'mobile']),
  score: z.number().min(1).max(10),
  label: z.string(),
  findings: z.array(z.object({
    severity: z.enum(['critical', 'major', 'minor', 'praise']),
    title: z.string(),
    description: z.string(),
    fixSuggestion: z.string().optional(),
    autoFixable: z.boolean().default(false),
  })),
});

export type CriticDimension = z.infer<typeof CriticDimensionSchema>;

export const SiteCritiqueSchema = z.object({
  siteId: z.string(),
  url: z.string().url(),
  gradedAt: z.string(),
  overallScore: z.number().min(1).max(10),
  grade: z.enum(['A+', 'A', 'B', 'C', 'D', 'F']),
  dimensions: z.array(CriticDimensionSchema),
  industryAvg: z.number().min(1).max(10).optional(),
  competitiveRank: z.string().optional(),
  priorityFixes: z.array(z.object({
    dimension: z.string(),
    title: z.string(),
    fix: z.string(),
    autoFixable: z.boolean(),
  })),
});

export type SiteCritique = z.infer<typeof SiteCritiqueSchema>;

export const CriticRequestSchema = z.object({
  url: z.string().url(),
  industry: z.string().optional(),
  competitorUrls: z.array(z.string().url()).max(5).optional(),
});

export type CriticRequest = z.infer<typeof CriticRequestSchema>;
