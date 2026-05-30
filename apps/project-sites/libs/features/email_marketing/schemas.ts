/**
 * @module libs/features/email_marketing/schemas
 * @description Zod schemas for Email Marketing — turning the existing
 * `newsletter_campaigns` draft stub into a real send pipeline whose audience is
 * the consented contacts captured by `contacts_core` plus confirmed newsletter
 * subscribers. No new table; builds on `newsletter_campaigns`.
 *
 * @packageDocumentation
 */

import { z } from 'zod';

/** Real recipient-count breakdown for a campaign's site (replaces the fake 1247). */
export const RecipientCountSchema = z
  .object({
    total: z.number().int().min(0),
    fromContacts: z.number().int().min(0),
    fromSubscribers: z.number().int().min(0),
  })
  .strict();
export type RecipientCount = z.infer<typeof RecipientCountSchema>;

/** Result of sending a campaign. */
export const SendResultSchema = z
  .object({
    campaignId: z.string().min(1),
    recipients: z.number().int().min(0),
    sent: z.number().int().min(0),
    failed: z.number().int().min(0),
    status: z.enum(['sent', 'partial', 'failed', 'no_recipients']),
  })
  .strict();
export type SendResult = z.infer<typeof SendResultSchema>;
