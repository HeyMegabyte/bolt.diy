/**
 * @module libs/features/prod_readiness_score/schemas
 * @description Zod schemas for Production Readiness Score — inputs, check shapes,
 * and the response envelope. Single source of truth for this feature's contract.
 */
import { z } from 'zod';

/** Input: caller passes the site ID from the URL param. */
export const GetReadinessInput = z.object({
  site_id: z.string().min(1, 'site_id is required'),
});
export type GetReadinessInput = z.infer<typeof GetReadinessInput>;

/** A single readiness check with its verdict. */
export const ReadinessCheck = z.object({
  name: z.string(),
  pass: z.boolean(),
  weight: z.number().int().min(0).max(100),
  hint: z.string(),
});
export type ReadinessCheck = z.infer<typeof ReadinessCheck>;

/** The letter grade derived from the numeric score. */
export const ReadinessGrade = z.enum(['A', 'B', 'C', 'D', 'F']);
export type ReadinessGrade = z.infer<typeof ReadinessGrade>;

/** Full response envelope returned by GET /api/sites/:siteId/readiness. */
export const ReadinessResponse = z.object({
  score: z.number().int().min(0).max(100),
  grade: ReadinessGrade,
  checks: z.array(ReadinessCheck),
});
export type ReadinessResponse = z.infer<typeof ReadinessResponse>;
