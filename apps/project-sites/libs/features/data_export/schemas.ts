/**
 * @module libs/features/data_export/schemas
 * @description Zod schemas for Data Export — owner data portability
 * (CLAUDE.md ethics: users own their data + can export anytime). MVP exports
 * the org's `contacts` as RFC4180 CSV with CSV-injection neutralization.
 *
 * @packageDocumentation
 */

import { z } from 'zod';

/** Query params for the contacts CSV export. */
export const ExportContactsQuerySchema = z
  .object({
    /** Optional: scope the export to a single site (else all org contacts). */
    siteId: z.string().min(1).optional(),
  })
  .strict();
export type ExportContactsQuery = z.infer<typeof ExportContactsQuerySchema>;

/** Columns emitted, in order. Exported for tests + docs. */
export const CONTACT_EXPORT_COLUMNS = [
  'email',
  'name',
  'phone',
  'source',
  'tags',
  'consent_email',
  'consent_sms',
  'created_at',
  'last_seen_at',
] as const;
