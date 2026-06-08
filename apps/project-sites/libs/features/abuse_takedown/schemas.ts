/**
 * @module libs/features/abuse_takedown/schemas
 * @description Zod boundary schemas for the abuse / takedown workflow.
 * Per [[zod-everywhere]] every request body is validated before use.
 */

import { z } from 'zod';

/** Categories an abuse report can fall under. */
export const ABUSE_CATEGORIES = ['dmca', 'illegal', 'malware', 'phishing', 'spam', 'other'] as const;

/** Public abuse-report submission body (`POST /api/abuse/report`). */
export const AbuseReportSubmitSchema = z
  .object({
    /** Slug or id of the published site being reported (resolved server-side). */
    site: z.string().min(1).max(255),
    category: z.enum(ABUSE_CATEGORIES),
    reason: z.string().min(8).max(4000),
    reporter_email: z.string().email().max(320).optional(),
    evidence_url: z.string().url().max(2048).optional(),
  })
  .strict();
export type AbuseReportSubmit = z.infer<typeof AbuseReportSubmitSchema>;

/** Operator resolution body (`POST /api/abuse/reports/:id/resolve`). */
export const AbuseReportResolveSchema = z
  .object({
    action: z.enum(['dismiss', 'takedown']),
    note: z.string().max(4000).optional(),
  })
  .strict();
export type AbuseReportResolve = z.infer<typeof AbuseReportResolveSchema>;

/** Shape returned for a single report. */
export const AbuseReportSchema = z.object({
  id: z.string(),
  site_id: z.string().nullable(),
  org_id: z.string().nullable(),
  reporter_email: z.string().nullable(),
  category: z.string(),
  reason: z.string(),
  evidence_url: z.string().nullable(),
  status: z.string(),
  resolution_note: z.string().nullable(),
  resolved_by: z.string().nullable(),
  created_at: z.string(),
  resolved_at: z.string().nullable(),
});
export type AbuseReport = z.infer<typeof AbuseReportSchema>;
