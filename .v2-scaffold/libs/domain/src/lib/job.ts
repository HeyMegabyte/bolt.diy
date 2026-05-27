/**
 * Job SSOT — runtime state of a dispatched booking. Mirrors D1
 * `workflow_jobs` for service-tenant dispatch flows.
 */
import { z } from 'zod';

export const JobStatusSchema = z.enum([
  'pending',
  'assigned',
  'enroute',
  'on_site',
  'completed',
  'cancelled',
  'disputed',
] as const);
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const JobLocationSchema = z
  .object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    heading: z.number().min(0).lt(360).nullable(),
    speed_mps: z.number().nonnegative().nullable(),
    eta_seconds: z.number().int().nonnegative().nullable(),
    captured_at: z.iso.datetime({ offset: true }),
  })
  .strict();

export type JobLocation = z.infer<typeof JobLocationSchema>;

export const JobSchema = z
  .object({
    id: z.string().min(1),
    tenant_id: z.string().min(1),
    booking_id: z.string().min(1),
    crew_id: z.string().min(1).nullable(),
    status: JobStatusSchema,
    location: JobLocationSchema.nullable(),
    started_at: z.iso.datetime({ offset: true }).nullable(),
    completed_at: z.iso.datetime({ offset: true }).nullable(),
    created_at: z.iso.datetime({ offset: true }),
    updated_at: z.iso.datetime({ offset: true }),
  })
  .strict();

export type Job = z.infer<typeof JobSchema>;
