/**
 * @module services/listmonk_email_provider
 *
 * @description
 * `ListmonkMarketingEmailProvider` — the real {@link MarketingEmailProvider}
 * (§42/ADR-0019), wrapping the existing DI'd `listmonk_client.ts` functions so
 * the bulk/newsletter rail goes through Listmonk (which relays via Amazon SES
 * SMTP). Completes the email rail alongside the SES transactional provider.
 *
 * The client functions never throw (typed result unions); this adapter maps a
 * `{ ok: false }` to a thrown error so it satisfies the port's success-or-throw
 * contract. `fetchImpl` is injectable for deterministic tests.
 *
 * @see docs/adr/0019-amazon-ses-plus-listmonk-email.md
 */

import {
  type ListmonkConfig,
  listmonkUpsertSubscriber,
  listmonkCreateCampaign,
  listmonkStartCampaign,
  listmonkUnsubscribe,
} from './listmonk_client.js';
import {
  EmailInputError,
  type CampaignResult,
  type CampaignSendResult,
  type CreateCampaignInput,
  type MarketingEmailProvider,
  type SubscriberResult,
  type UnsubscribeInput,
  type UpsertSubscriberInput,
} from '../platform/email.js';

export class ListmonkMarketingEmailProvider implements MarketingEmailProvider {
  constructor(
    private readonly cfg: ListmonkConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async upsertSubscriber(input: UpsertSubscriberInput): Promise<SubscriberResult> {
    if (!/.+@.+\..+/.test(input.email)) throw new EmailInputError('valid email required', 'email');
    const name = input.attribs?.name ?? input.email;
    const r = await listmonkUpsertSubscriber(this.cfg, { email: input.email, name, lists: [] }, this.fetchImpl);
    if (!r.ok) throw new Error(`Listmonk upsertSubscriber failed: ${r.reason}`);
    return { id: String(r.id) };
  }

  async createCampaign(input: CreateCampaignInput): Promise<CampaignResult> {
    const r = await listmonkCreateCampaign(
      this.cfg,
      { name: input.name, subject: input.subject, body: input.body, lists: [...(input.listIds ?? [])] },
      this.fetchImpl,
    );
    if (!r.ok) throw new Error(`Listmonk createCampaign failed: ${r.reason}`);
    return { id: String(r.id) };
  }

  async sendCampaign(input: { campaignId: string }): Promise<CampaignSendResult> {
    const id = Number(input.campaignId);
    if (!Number.isFinite(id)) throw new EmailInputError('numeric campaignId required', 'campaignId');
    const r = await listmonkStartCampaign(this.cfg, id, this.fetchImpl);
    if (!r.ok) throw new Error(`Listmonk sendCampaign failed: ${r.reason}`);
    return { id: input.campaignId, started: true };
  }

  async unsubscribe(input: UnsubscribeInput): Promise<void> {
    const r = await listmonkUnsubscribe(this.cfg, input.email, this.fetchImpl);
    if (!r.ok) throw new Error(`Listmonk unsubscribe failed: ${r.reason}`);
  }
}
