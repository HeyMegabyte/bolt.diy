/**
 * @module libs/features/donations_engine/service
 * @description Campaign management + donation recording. `recordDonation`
 * inserts the donation, atomically bumps the campaign's `raised_cents` +
 * `donor_count`, and (unless anonymous) records the donor into `contacts_core`
 * — the 5th consumer of the shared contacts store.
 *
 * Payment capture is NOT here: Square (per payments-routing) captures funds on
 * the published site, then its verified webhook calls `recordDonation`. This
 * keeps fabricated donations impossible (no public write path).
 *
 * @packageDocumentation
 */

import type { Env } from '../../../src/types/env.js';
import { dbQuery, dbExecute } from '../../../src/services/db.js';
import { recordContact } from '../contacts_core/service.js';
import {
  CreateCampaignSchema,
  CampaignSchema,
  RecordDonationSchema,
  DonationResultSchema,
  type CreateCampaignInput,
  type Campaign,
  type RecordDonationInput,
  type DonationResult,
} from './schemas.js';

/** Flag key gating this feature. */
export const FLAG_KEY = 'donations_engine';

interface CampaignRow {
  id: string;
  site_id: string;
  name: string;
  goal_cents: number | null;
  raised_cents: number;
  donor_count: number;
  ends_at: string | null;
  created_at: string;
}

/** Map a raw row to a validated {@link Campaign}. */
function rowToCampaign(r: CampaignRow): Campaign {
  return CampaignSchema.parse({
    id: r.id,
    siteId: r.site_id,
    name: r.name,
    goalCents: r.goal_cents,
    raisedCents: r.raised_cents,
    donorCount: r.donor_count,
    endsAt: r.ends_at,
    createdAt: r.created_at,
  });
}

/** Resolve a campaign's owning org (via its site). Null if not found. */
export async function campaignOrgId(env: Env, campaignId: string): Promise<string | null> {
  const { data } = await dbQuery<{ org_id: string }>(
    env.DB,
    `SELECT s.org_id FROM donation_campaigns c JOIN sites s ON s.id = c.site_id
      WHERE c.id = ? AND s.deleted_at IS NULL`,
    [campaignId],
  );
  return data[0]?.org_id ?? null;
}

/** Create a campaign for a site the caller's org owns (ownership checked by handler). */
export async function createCampaign(env: Env, input: CreateCampaignInput): Promise<Campaign> {
  const v = CreateCampaignSchema.parse(input);
  const id = crypto.randomUUID();
  await dbExecute(
    env.DB,
    `INSERT INTO donation_campaigns (id, site_id, name, goal_cents, raised_cents, donor_count, ends_at, created_at)
     VALUES (?, ?, ?, ?, 0, 0, ?, datetime('now'))`,
    [id, v.siteId, v.name, v.goalCents ?? null, v.endsAt ?? null],
  );
  const { data } = await dbQuery<CampaignRow>(
    env.DB,
    `SELECT * FROM donation_campaigns WHERE id = ?`,
    [id],
  );
  return rowToCampaign(data[0]!);
}

/** List campaigns for an org (joined via sites). */
export async function listCampaigns(env: Env, orgId: string): Promise<Campaign[]> {
  const { data } = await dbQuery<CampaignRow>(
    env.DB,
    `SELECT c.* FROM donation_campaigns c JOIN sites s ON s.id = c.site_id
      WHERE s.org_id = ? AND s.deleted_at IS NULL ORDER BY c.created_at DESC LIMIT 200`,
    [orgId],
  );
  return data.map(rowToCampaign);
}

/** Fetch one campaign by id (no org filter — caller decides public vs scoped). */
export async function getCampaign(env: Env, campaignId: string): Promise<Campaign | null> {
  const { data } = await dbQuery<CampaignRow>(
    env.DB,
    `SELECT * FROM donation_campaigns WHERE id = ?`,
    [campaignId],
  );
  return data[0] ? rowToCampaign(data[0]) : null;
}

/**
 * Record a confirmed donation: insert it, bump the campaign totals, and capture
 * the donor as a contact (unless anonymous).
 *
 * @remarks Call ONLY after payment capture (from the Square webhook). The donor
 * contact is recorded with `source: 'donation'` and NO marketing consent — a
 * donation is a transaction, not a newsletter opt-in.
 * @returns A {@link DonationResult} with refreshed campaign totals.
 * @throws ZodError on invalid input; Error if the campaign doesn't exist.
 */
export async function recordDonation(
  env: Env,
  input: RecordDonationInput,
): Promise<DonationResult> {
  const v = RecordDonationSchema.parse(input);
  const campaign = await getCampaign(env, v.campaignId);
  if (!campaign) throw new Error(`Campaign not found: ${v.campaignId}`);

  const donationId = crypto.randomUUID();
  await dbExecute(
    env.DB,
    `INSERT INTO donations (id, campaign_id, donor_email, amount_cents, recurring, anonymous, memorial, stripe_payment_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    [
      donationId,
      v.campaignId,
      v.anonymous ? null : (v.donorEmail ?? null),
      v.amountCents,
      v.recurring ? 1 : 0,
      v.anonymous ? 1 : 0,
      v.memorial ?? null,
      v.paymentId ?? null,
    ],
  );
  // Atomic totals bump (single UPDATE — D1 has no multi-statement transaction).
  await dbExecute(
    env.DB,
    `UPDATE donation_campaigns
        SET raised_cents = raised_cents + ?, donor_count = donor_count + 1
      WHERE id = ?`,
    [v.amountCents, v.campaignId],
  );

  // Capture the donor into contacts_core (5th consumer) — non-fatal, no consent.
  if (!v.anonymous && v.donorEmail) {
    try {
      const orgId = await campaignOrgId(env, v.campaignId);
      if (orgId) {
        await recordContact(env, {
          orgId,
          siteId: campaign.siteId,
          email: v.donorEmail,
          name: v.donorName,
          source: 'donation',
          tags: ['donor'],
          metadata: {
            campaignId: v.campaignId,
            lastAmountCents: v.amountCents,
            recurring: v.recurring,
          },
        });
      }
    } catch {
      /* contact capture is best-effort; never fail a recorded donation over it */
    }
  }

  const refreshed = await getCampaign(env, v.campaignId);
  return DonationResultSchema.parse({
    donationId,
    campaignId: v.campaignId,
    amountCents: v.amountCents,
    raisedCents: refreshed?.raisedCents ?? campaign.raisedCents + v.amountCents,
    donorCount: refreshed?.donorCount ?? campaign.donorCount + 1,
  });
}
