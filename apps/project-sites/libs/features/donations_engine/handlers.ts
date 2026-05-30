/**
 * @module libs/features/donations_engine/handlers
 * @description Hono routes for the Donations Engine.
 *
 * | Method | Path                          | Auth   | Purpose                          |
 * | ------ | ----------------------------- | ------ | -------------------------------- |
 * | POST   | /api/donations/campaigns      | yes    | Create a campaign for own site   |
 * | GET    | /api/donations/campaigns      | yes    | List own org's campaigns         |
 * | GET    | /api/donations/campaigns/:id  | public | Campaign progress for the widget |
 *
 * Auth + flag gating come from the shared `feature_guard`: `requireOrgFlag` for
 * the org-scoped write/list routes, `requireFlag` (flag-only, no auth) for the
 * public per-campaign progress read. All 404 when the `donations_engine` flag is
 * off. There is intentionally NO public "create donation" route — donations are
 * recorded only by the payment webhook via `recordDonation`.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../../../src/types/env.js';
import {
  requireOrgFlag,
  requireFlag,
  badRequest,
  notFound,
} from '../../../src/lib/feature_guard.js';
import { dbQuery } from '../../../src/services/db.js';
import { CreateCampaignSchema } from './schemas.js';
import { FLAG_KEY, createCampaign, listCampaigns, getCampaign } from './service.js';

type AppContext = { Bindings: Env; Variables: Variables };

export const donationsEngine = new Hono<AppContext>();

donationsEngine.post('/api/donations/campaigns', async (c) => {
  const g = await requireOrgFlag(c, FLAG_KEY);
  if (g instanceof Response) return g;

  const body = await c.req.json().catch(() => null);
  const parsed = CreateCampaignSchema.safeParse(body ?? {});
  if (!parsed.success) return badRequest(c, parsed.error.flatten());

  // The site must belong to the caller's org — never trust a cross-org siteId.
  const { data } = await dbQuery<{ org_id: string }>(
    c.env.DB,
    'SELECT org_id FROM sites WHERE id = ? AND deleted_at IS NULL',
    [parsed.data.siteId],
  );
  if (data[0]?.org_id !== g.orgId) return notFound(c);

  const campaign = await createCampaign(c.env, parsed.data);
  return c.json({ campaign }, 201);
});

donationsEngine.get('/api/donations/campaigns', async (c) => {
  const g = await requireOrgFlag(c, FLAG_KEY);
  if (g instanceof Response) return g;
  return c.json({ campaigns: await listCampaigns(c.env, g.orgId) });
});

donationsEngine.get('/api/donations/campaigns/:id', async (c) => {
  // Public progress read for the donate widget — flag-gated, no auth.
  const gate = await requireFlag(c, FLAG_KEY);
  if (gate !== true) return gate;
  const campaign = await getCampaign(c.env, c.req.param('id'));
  if (!campaign) return notFound(c);
  // Only non-sensitive progress fields are public.
  return c.json({
    id: campaign.id,
    name: campaign.name,
    goalCents: campaign.goalCents,
    raisedCents: campaign.raisedCents,
    donorCount: campaign.donorCount,
    endsAt: campaign.endsAt,
  });
});
