/**
 * Audit log schemas
 */
import { z } from 'zod';
import { uuidSchema, timestampsSchema } from './base.js';
import { AUDIT_ACTIONS } from '../constants/index.js';

// ============================================================================
// AUDIT LOG ENTRY
// ============================================================================

export const auditActionSchema = z.enum(Object.values(AUDIT_ACTIONS) as [string, ...string[]]);

export const auditLogSchema = z.object({
  id: uuidSchema,
  org_id: uuidSchema,
  actor_id: uuidSchema.nullable().optional(),
  actor_type: z.enum(['user', 'system', 'api_key', 'webhook']).default('user'),
  action: auditActionSchema,
  target_type: z.string().max(50),
  target_id: uuidSchema.nullable().optional(),
  metadata: z.record(z.unknown()).nullable().optional(),
  ip_address: z.string().nullable().optional(),
  user_agent: z.string().max(500).nullable().optional(),
  request_id: z.string().max(100).nullable().optional(),
  created_at: z.string().datetime(),
});

export const createAuditLogInputSchema = z.object({
  org_id: uuidSchema,
  actor_id: uuidSchema.optional(),
  actor_type: z.enum(['user', 'system', 'api_key', 'webhook']).optional(),
  action: auditActionSchema,
  target_type: z.string().max(50),
  target_id: uuidSchema.optional(),
  metadata: z.record(z.unknown()).optional(),
  ip_address: z.string().optional(),
  user_agent: z.string().max(500).optional(),
  request_id: z.string().max(100).optional(),
});

// ============================================================================
// AUDIT LOG QUERY
// ============================================================================

export const auditLogQuerySchema = z.object({
  org_id: uuidSchema,
  actor_id: uuidSchema.optional(),
  action: auditActionSchema.optional(),
  target_type: z.string().optional(),
  target_id: uuidSchema.optional(),
  start_date: z.string().datetime().optional(),
  end_date: z.string().datetime().optional(),
  page: z.number().int().positive().default(1),
  limit: z.number().int().positive().max(100).default(50),
});

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export type AuditAction = z.infer<typeof auditActionSchema>;
export type AuditLog = z.infer<typeof auditLogSchema>;
export type CreateAuditLogInput = z.infer<typeof createAuditLogInputSchema>;
export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>;
