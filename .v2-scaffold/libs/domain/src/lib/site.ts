/**
 * Site SSOT. Mirrors D1 `sites` + `hostnames`.
 */
import { z } from 'zod';

export const SiteStatusSchema = z.enum([
  'draft',
  'building',
  'ready',
  'published',
  'failed',
  'archived',
] as const);
export type SiteStatus = z.infer<typeof SiteStatusSchema>;

export const SiteSchema = z
  .object({
    id: z.string().min(1),
    slug: z
      .string()
      .min(1)
      .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, 'invalid site slug'),
    tenant_id: z.string().min(1),
    primary_hostname: z.string().min(1).nullable(),
    d1_id: z.string().min(1).nullable(),
    r2_prefix: z.string().min(1),
    status: SiteStatusSchema,
    created_at: z.iso.datetime({ offset: true }),
    updated_at: z.iso.datetime({ offset: true }),
  })
  .strict();

export type Site = z.infer<typeof SiteSchema>;
