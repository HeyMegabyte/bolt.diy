/**
 * @module libs/features/aeo_pass/schemas
 * @description Zod schemas for the AEO Pass feature module.
 *
 * @remarks All runtime boundaries for this feature are validated here.
 * Service and handler layers import from this file; types are inferred
 * so there is no manual interface drift.
 */

import { z } from 'zod';

/** A single AEO audit row as stored in D1 and returned to callers. */
export const AeoAuditSchema = z.object({
  id: z.string().uuid(),
  siteId: z.string().min(1),
  orgId: z.string().nullable(),
  score: z.number().int().min(0).max(100),
  issues: z.array(z.string()),
  createdAt: z.string(),
});

export type AeoAudit = z.infer<typeof AeoAuditSchema>;

/** POST /api/aeo/audit/:siteId — no body required; siteId is the path param. */
export const RunAeoAuditParamsSchema = z.object({
  siteId: z.string().min(1, 'siteId is required'),
});

export type RunAeoAuditParams = z.infer<typeof RunAeoAuditParamsSchema>;

/** Response envelope for a successful audit run. */
export const RunAeoAuditResponseSchema = z.object({
  ok: z.literal(true),
  audit: AeoAuditSchema,
});

export type RunAeoAuditResponse = z.infer<typeof RunAeoAuditResponseSchema>;

/** Response envelope for GET /api/aeo/:siteId (latest audit or null). */
export const GetAeoAuditResponseSchema = z.object({
  ok: z.literal(true),
  audit: AeoAuditSchema.nullable(),
});

export type GetAeoAuditResponse = z.infer<typeof GetAeoAuditResponseSchema>;
