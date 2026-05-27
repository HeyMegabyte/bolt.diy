/**
 * Crew profile SSOT — driver/contractor identity, compliance state,
 * online status, earnings + rating.
 */
import { z } from 'zod';

export const CrewOnlineStatusSchema = z.enum([
  'offline',
  'available',
  'on_job',
  'on_break',
] as const);
export type CrewOnlineStatus = z.infer<typeof CrewOnlineStatusSchema>;

export const CrewComplianceSchema = z
  .object({
    background_check_passed: z.boolean(),
    drug_test_passed: z.boolean(),
    license_verified: z.boolean(),
    insurance_verified: z.boolean(),
    last_audited_at: z.iso.datetime({ offset: true }).nullable(),
  })
  .strict();

export type CrewCompliance = z.infer<typeof CrewComplianceSchema>;

export const CrewVehicleSchema = z
  .object({
    make: z.string().min(1),
    model: z.string().min(1),
    year: z.number().int().min(1900).max(2100),
    plate: z.string().min(1),
    capacity_cubic_ft: z.number().nonnegative().nullable(),
  })
  .strict();

export type CrewVehicle = z.infer<typeof CrewVehicleSchema>;

export const CrewDocumentSchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum(['license', 'insurance', 'w9', 'i9', 'other'] as const),
    url: z.url(),
    expires_at: z.iso.datetime({ offset: true }).nullable(),
    verified_at: z.iso.datetime({ offset: true }).nullable(),
  })
  .strict();

export type CrewDocument = z.infer<typeof CrewDocumentSchema>;

export const CrewProfileSchema = z
  .object({
    id: z.string().min(1),
    user_id: z.string().min(1),
    tenant_id: z.string().min(1),
    online_status: CrewOnlineStatusSchema,
    rating: z.number().min(0).max(5).nullable(),
    earnings_cents_ytd: z.number().int().nonnegative(),
    completed_jobs: z.number().int().nonnegative(),
    documents: z.array(CrewDocumentSchema).default([]),
    vehicle: CrewVehicleSchema.nullable(),
    compliance: CrewComplianceSchema,
    created_at: z.iso.datetime({ offset: true }),
  })
  .strict();

export type CrewProfile = z.infer<typeof CrewProfileSchema>;
