/**
 * @module libs/features/audit_trail_export/schemas
 * @description Zod contracts for the audit_trail_export feature.
 * Query params for filtering the audit_logs table and the response envelope.
 * Real audit_logs columns: id, org_id, actor_id, action, target_type, target_id, request_id, created_at.
 */
import { z } from 'zod';

/** Query parameters accepted by GET /api/audit/export */
export const AuditExportQuerySchema = z.object({
  /** Filter by action string (e.g. "site.created"). Optional. */
  action: z.string().max(100).optional(),
  /** ISO 8601 date-time lower bound for created_at (inclusive). Optional. */
  from: z.string().datetime({ offset: true }).optional(),
  /** ISO 8601 date-time upper bound for created_at (inclusive). Optional. */
  to: z.string().datetime({ offset: true }).optional(),
  /** Maximum number of rows to return. Default 100, max 1000. */
  limit: z.coerce.number().int().min(1).max(1000).default(100),
  /** Response format. Default json. */
  format: z.enum(['json', 'csv']).default('json'),
});
export type AuditExportQuery = z.infer<typeof AuditExportQuerySchema>;

/** A single audit log row returned in the response. */
export const AuditLogEntrySchema = z.object({
  id: z.string(),
  org_id: z.string(),
  actor_id: z.string().nullable(),
  action: z.string(),
  target_type: z.string().nullable(),
  target_id: z.string().nullable(),
  request_id: z.string().nullable(),
  created_at: z.string(),
});
export type AuditLogEntry = z.infer<typeof AuditLogEntrySchema>;

/** JSON response envelope for format=json. */
export const AuditExportJsonResponseSchema = z.object({
  count: z.number().int(),
  entries: z.array(AuditLogEntrySchema),
});
export type AuditExportJsonResponse = z.infer<typeof AuditExportJsonResponseSchema>;
