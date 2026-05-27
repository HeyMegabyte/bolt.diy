/**
 * Audit log SSOT. Mirrors D1 `audit_logs`, `super_admin_audit`,
 * `impersonation_sessions`.
 */
import { z } from 'zod';

export const AuditActorTypeSchema = z.enum([
  'user',
  'system',
  'cron',
  'webhook',
  'super_admin',
  'impersonator',
] as const);
export type AuditActorType = z.infer<typeof AuditActorTypeSchema>;

export const AuditLogSchema = z
  .object({
    id: z.string().min(1),
    tenant_id: z.string().min(1).nullable(),
    actor_type: AuditActorTypeSchema,
    actor_id: z.string().min(1).nullable(),
    action: z.string().min(1),
    target_type: z.string().min(1).nullable(),
    target_id: z.string().min(1).nullable(),
    diff: z.record(z.string(), z.unknown()).nullable(),
    ip: z.string().min(1).nullable(),
    ua: z.string().min(1).nullable(),
    request_id: z.string().min(1).nullable(),
    created_at: z.iso.datetime({ offset: true }),
  })
  .strict();

export type AuditLog = z.infer<typeof AuditLogSchema>;
