/**
 * @module libs/features/email_marketing/service
 * @description Real send pipeline for newsletter campaigns. Resolves the
 * audience from `contacts_core` (consent_email = 1) + confirmed
 * `newsletter_subscribers`, deduped by lowercased email, and sends via Resend's
 * batch endpoint. Replaces the `newsletterCreateCampaign` stub's fabricated
 * recipient count with a real one.
 *
 * @packageDocumentation
 */

import type { Env } from '../../../src/types/env.js';
import { dbQuery, dbExecute } from '../../../src/services/db.js';
import {
  RecipientCountSchema,
  SendResultSchema,
  type RecipientCount,
  type SendResult,
} from './schemas.js';
import { unsubscribeUrl, unsubscribeFooterHtml } from './unsubscribe.js';

/** Flag key gating this feature. */
export const FLAG_KEY = 'email_marketing';

/** A campaign row (subset) joined with its site's org. */
export interface CampaignRow {
  id: string;
  site_id: string;
  org_id: string;
  subject: string;
  body_html: string;
  status: string;
}

/** Load a campaign and resolve its owning org. Returns null if not found. */
export async function loadCampaign(env: Env, campaignId: string): Promise<CampaignRow | null> {
  const { data } = await dbQuery<CampaignRow>(
    env.DB,
    `SELECT nc.id, nc.site_id, s.org_id, nc.subject, nc.body_html, nc.status
       FROM newsletter_campaigns nc JOIN sites s ON s.id = nc.site_id
      WHERE nc.id = ? AND s.deleted_at IS NULL`,
    [campaignId],
  );
  return data[0] ?? null;
}

/** Resolve the deduped recipient email list for a site (consented contacts + confirmed subs). */
export async function resolveRecipients(
  env: Env,
  orgId: string,
  siteId: string,
): Promise<string[]> {
  const [contactsRes, subsRes] = await Promise.all([
    dbQuery<{ email: string }>(
      env.DB,
      `SELECT DISTINCT lower(email) AS email FROM contacts
        WHERE org_id = ? AND site_id = ? AND consent_email = 1 AND email IS NOT NULL AND deleted_at IS NULL`,
      [orgId, siteId],
    ),
    dbQuery<{ email: string }>(
      env.DB,
      `SELECT DISTINCT lower(email) AS email FROM newsletter_subscribers
        WHERE site_id = ? AND confirmed = 1 AND unsubscribed = 0`,
      [siteId],
    ),
  ]);
  const set = new Set<string>();
  for (const r of contactsRes.error ? [] : contactsRes.data) if (r.email) set.add(r.email);
  for (const r of subsRes.error ? [] : subsRes.data) if (r.email) set.add(r.email);
  return [...set];
}

/** Real recipient-count breakdown (replaces the stub's fabricated 1247). */
export async function estimateRecipients(
  env: Env,
  orgId: string,
  siteId: string,
): Promise<RecipientCount> {
  const [contactsRes, subsRes, total] = await Promise.all([
    dbQuery<{ n: number }>(
      env.DB,
      `SELECT COUNT(DISTINCT lower(email)) AS n FROM contacts
        WHERE org_id = ? AND site_id = ? AND consent_email = 1 AND email IS NOT NULL AND deleted_at IS NULL`,
      [orgId, siteId],
    ).then((r) => (r.error ? 0 : Number(r.data[0]?.n ?? 0))),
    dbQuery<{ n: number }>(
      env.DB,
      `SELECT COUNT(DISTINCT lower(email)) AS n FROM newsletter_subscribers
        WHERE site_id = ? AND confirmed = 1 AND unsubscribed = 0`,
      [siteId],
    ).then((r) => (r.error ? 0 : Number(r.data[0]?.n ?? 0))),
    resolveRecipients(env, orgId, siteId).then((list) => list.length),
  ]);
  return RecipientCountSchema.parse({ total, fromContacts: contactsRes, fromSubscribers: subsRes });
}

/**
 * Send a Resend batch (≤100). Each item carries its own per-recipient HTML so
 * the unsubscribe link is unique per address. Returns count sent; throws on a
 * hard API failure.
 */
async function sendResendBatch(
  apiKey: string,
  subject: string,
  items: Array<{ to: string; html: string }>,
): Promise<number> {
  if (items.length === 0) return 0;
  const res = await fetch('https://api.resend.com/emails/batch', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(
      items.map(({ to, html }) => ({
        from: 'Project Sites <noreply@megabyte.space>',
        to: [to],
        subject,
        html,
      })),
    ),
  });
  if (!res.ok) throw new Error(`Resend batch failed (status ${res.status})`);
  return items.length;
}

/**
 * Send a campaign to its consented audience via Resend, batched by 100.
 *
 * @remarks Idempotency: a campaign already `sent` is not re-sent. Org-ownership
 * must be checked by the caller (handler) before invoking.
 * @returns A {@link SendResult}.
 * @throws Error when `RESEND_API_KEY` is missing or a batch hard-fails.
 */
export async function sendCampaign(env: Env, campaign: CampaignRow): Promise<SendResult> {
  if (campaign.status === 'sent') {
    return SendResultSchema.parse({
      campaignId: campaign.id,
      recipients: 0,
      sent: 0,
      failed: 0,
      status: 'sent',
    });
  }
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) throw new Error('Email delivery is not configured (RESEND_API_KEY missing)');

  const recipients = await resolveRecipients(env, campaign.org_id, campaign.site_id);
  if (recipients.length === 0) {
    await dbExecute(
      env.DB,
      `UPDATE newsletter_campaigns SET status = 'sent', sent_count = 0 WHERE id = ?`,
      [campaign.id],
    );
    return SendResultSchema.parse({
      campaignId: campaign.id,
      recipients: 0,
      sent: 0,
      failed: 0,
      status: 'no_recipients',
    });
  }

  let sent = 0;
  let failed = 0;
  for (let i = 0; i < recipients.length; i += 100) {
    const batch = recipients.slice(i, i + 100);
    // Per-recipient HTML: append a unique signed unsubscribe footer (CAN-SPAM/GDPR).
    const items = await Promise.all(
      batch.map(async (email) => ({
        to: email,
        html:
          campaign.body_html +
          unsubscribeFooterHtml(await unsubscribeUrl(env, email, campaign.site_id)),
      })),
    );
    try {
      sent += await sendResendBatch(apiKey, campaign.subject, items);
    } catch {
      failed += batch.length;
    }
  }
  const status = failed === 0 ? 'sent' : sent === 0 ? 'failed' : 'partial';
  await dbExecute(
    env.DB,
    `UPDATE newsletter_campaigns SET status = ?, sent_count = ? WHERE id = ?`,
    [status === 'failed' ? 'failed' : 'sent', sent, campaign.id],
  );
  return SendResultSchema.parse({
    campaignId: campaign.id,
    recipients: recipients.length,
    sent,
    failed,
    status,
  });
}
