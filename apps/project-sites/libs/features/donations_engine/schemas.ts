/**
 * @module libs/features/donations_engine/schemas
 * @description Zod schemas for the Donations Engine — campaign management +
 * donation recording on the existing `donation_campaigns`/`donations` tables.
 * The donor is captured into `contacts_core` (5th consumer). Payment capture
 * (Square per payments-routing) calls `recordDonation` from its webhook — this
 * module owns campaign state + donor recording, not the payment rail itself.
 *
 * @packageDocumentation
 */

import { z } from 'zod';

/** Input to create a fundraising campaign for a site. */
export const CreateCampaignSchema = z
  .object({
    siteId: z.string().min(1),
    name: z.string().min(1).max(200),
    goalCents: z.number().int().positive().optional(),
    endsAt: z.string().datetime().optional(),
  })
  .strict();
export type CreateCampaignInput = z.infer<typeof CreateCampaignSchema>;

/** A campaign as returned to callers. */
export const CampaignSchema = z
  .object({
    id: z.string(),
    siteId: z.string(),
    name: z.string(),
    goalCents: z.number().int().nullable(),
    raisedCents: z.number().int().min(0),
    donorCount: z.number().int().min(0),
    endsAt: z.string().nullable(),
    createdAt: z.string(),
  })
  .strict();
export type Campaign = z.infer<typeof CampaignSchema>;

/**
 * Input to record a confirmed donation. Called by the payment webhook AFTER
 * capture (never a public endpoint — that would allow fabricated donations).
 */
export const RecordDonationSchema = z
  .object({
    campaignId: z.string().min(1),
    amountCents: z.number().int().positive(),
    donorEmail: z.string().email().optional(),
    donorName: z.string().min(1).max(200).optional(),
    recurring: z.boolean().default(false),
    anonymous: z.boolean().default(false),
    memorial: z.string().max(200).optional(),
    paymentId: z.string().max(200).optional(),
  })
  .strict();
export type RecordDonationInput = z.infer<typeof RecordDonationSchema>;

/** Result of recording a donation. */
export const DonationResultSchema = z
  .object({
    donationId: z.string(),
    campaignId: z.string(),
    amountCents: z.number().int(),
    raisedCents: z.number().int(),
    donorCount: z.number().int(),
  })
  .strict();
export type DonationResult = z.infer<typeof DonationResultSchema>;
