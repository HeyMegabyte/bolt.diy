/**
 * @module services/donations
 * @description Record completed Stripe donation checkouts. The public `/api/donate`
 * endpoint (`routes/search.ts`) creates a Stripe Checkout session tagged with
 * `metadata.kind = 'donation'` + `site_id` + `amount_cents`; on completion the Stripe
 * webhook (`routes/webhooks.ts` `checkout.session.completed`) routes here to persist
 * the donation into `donations` and bump the site's `donation_campaigns` aggregates.
 *
 * Before this existed, a completed donation was NEVER recorded — the money vanished
 * from the platform's records and `/admin` analytics "raised" was always $0.
 *
 * @packageDocumentation
 */

import type { Env } from '../types/env.js';
import { dbInsert, dbQueryOne, dbExecute } from './db.js';

/** The subset of a Stripe Checkout Session the donation recorder reads. */
export interface DonationSession {
  id: string;
  amount_total?: number | null;
  mode?: string;
  customer_email?: string | null;
  customer_details?: { email?: string | null } | null;
  payment_intent?: string | { id?: string } | null;
  metadata?: Record<string, string> | null;
}

/**
 * Persist a completed donation checkout, attributing it to the site's donation
 * campaign (resolve-or-create a "General Fund" on the site's first donation, since
 * `donations.campaign_id` is NOT NULL) and bumping the campaign's `raised_cents` +
 * `donor_count`. Idempotent on `stripe_payment_id` (belt-and-braces atop the
 * `webhook_events` event-dedup — Stripe can resend and there is no UNIQUE index).
 *
 * @remarks Never throws into the webhook: a failure is logged (structured warn →
 * Workers Observability) so it is surfaced, never silent, and the rest of the
 * webhook dispatch is unaffected.
 *
 * @param env - Worker env (uses `env.DB`).
 * @param session - The Stripe `checkout.session.completed` object (`event.data.object`).
 *
 * @example
 * ```ts
 * if (meta.kind === 'donation') { await handleDonationCheckout(c.env, obj); break; }
 * ```
 */
export async function handleDonationCheckout(env: Env, session: DonationSession): Promise<void> {
  const meta = session.metadata ?? {};
  const siteId = meta.site_id;
  if (!siteId) {
    console.warn(
      JSON.stringify({ level: 'warn', service: 'donations', message: 'donation_missing_site_id', session: session.id }),
    );
    return;
  }
  const amountCents = Number(session.amount_total ?? meta.amount_cents ?? 0) || 0;
  if (amountCents <= 0) {
    console.warn(
      JSON.stringify({ level: 'warn', service: 'donations', message: 'donation_zero_amount', session: session.id }),
    );
    return;
  }
  const email = session.customer_details?.email ?? session.customer_email ?? null;
  const paymentId =
    typeof session.payment_intent === 'string'
      ? session.payment_intent
      : (session.payment_intent?.id ?? session.id);

  // Idempotency — skip a payment already recorded (Stripe resends; no UNIQUE index).
  const existing = await dbQueryOne<{ id: string }>(
    env.DB,
    'SELECT id FROM donations WHERE stripe_payment_id = ?',
    [paymentId],
  );
  if (existing) return;

  // Resolve-or-create the site's donation campaign (campaign_id is NOT NULL). The
  // first donation to a site seeds a "General Fund"; later donations reuse it.
  const campaign = await dbQueryOne<{ id: string }>(
    env.DB,
    'SELECT id FROM donation_campaigns WHERE site_id = ? ORDER BY created_at ASC LIMIT 1',
    [siteId],
  );
  let campaignId = campaign?.id;
  if (!campaignId) {
    campaignId = crypto.randomUUID();
    const { error: campErr } = await dbInsert(env.DB, 'donation_campaigns', {
      id: campaignId,
      site_id: siteId,
      name: 'General Fund',
    });
    if (campErr) {
      console.warn(
        JSON.stringify({ level: 'warn', service: 'donations', message: 'campaign_create_failed', site_id: siteId, error: campErr }),
      );
      return;
    }
  }

  const { error } = await dbInsert(env.DB, 'donations', {
    id: crypto.randomUUID(),
    campaign_id: campaignId,
    donor_email: email,
    amount_cents: amountCents,
    recurring: session.mode === 'subscription' ? 1 : 0,
    anonymous: (meta.donor_name ?? '') === 'Anonymous' ? 1 : 0,
    stripe_payment_id: paymentId,
  });
  if (error) {
    console.warn(
      JSON.stringify({ level: 'warn', service: 'donations', message: 'donation_insert_failed', session: session.id, error }),
    );
    return;
  }

  // Bump campaign aggregates (the donations rows are the source of truth; this is a
  // denormalized convenience total). Best-effort — a bump failure never loses the row.
  const { error: bumpErr } = await dbExecute(
    env.DB,
    'UPDATE donation_campaigns SET raised_cents = raised_cents + ?, donor_count = donor_count + 1 WHERE id = ?',
    [amountCents, campaignId],
  );
  if (bumpErr) {
    console.warn(
      JSON.stringify({ level: 'warn', service: 'donations', message: 'campaign_bump_failed', campaign_id: campaignId, error: bumpErr }),
    );
  }
}
