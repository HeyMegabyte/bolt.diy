import { z } from 'zod';

/** Request body for a DSAR operation. */
export const DsarBodySchema = z.object({
  /**
   * The data subject identifier.  Accepts either an email address or an
   * opaque visitor_id string.  Must be non-empty.
   */
  subject: z.string().min(1, 'subject is required'),
  /** Whether to export the visitor records or permanently soft-delete them. */
  mode: z.enum(['export', 'delete'], {
    errorMap: () => ({ message: "mode must be 'export' or 'delete'" }),
  }),
});

export type DsarBody = z.infer<typeof DsarBodySchema>;

/** Shape of a single visitor_identities row returned in export responses. */
export const VisitorIdentityExportSchema = z.object({
  id: z.string(),
  org_id: z.string(),
  site_id: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  visitor_id: z.string().nullable(),
  anon_id: z.string().nullable(),
  display_name: z.string().nullable(),
  first_seen_at: z.string(),
  last_seen_at: z.string(),
  channel_flags: z.string(),
  metadata_json: z.string(),
});

export type VisitorIdentityExport = z.infer<typeof VisitorIdentityExportSchema>;

/** Success response for an export DSAR. */
export const DsarExportResponseSchema = z.object({
  mode: z.literal('export'),
  records: z.array(VisitorIdentityExportSchema),
  count: z.number().int().nonnegative(),
});

/** Success response for a delete DSAR. */
export const DsarDeleteResponseSchema = z.object({
  mode: z.literal('delete'),
  deleted: z.number().int().nonnegative(),
});
