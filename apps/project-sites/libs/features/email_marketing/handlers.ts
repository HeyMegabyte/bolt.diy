/**
 * @module libs/features/email_marketing/handlers
 * @description Hono routes for Email Marketing campaign sending.
 *
 * | Method | Path                                       | Purpose                       |
 * | ------ | ------------------------------------------ | ----------------------------- |
 * | GET    | /api/marketing/campaigns/:id/recipients    | Real recipient-count estimate |
 * | POST   | /api/marketing/campaigns/:id/send          | Send the campaign via Resend  |
 * | GET    | /api/marketing/unsubscribe                 | Public one-click unsubscribe  |
 *
 * Campaign routes use the shared `requireOrgFlag` (auth + flag) then add a
 * campaign-ownership check (the campaign's org must match the caller's). The
 * unsubscribe route is PUBLIC and NOT flag-gated — a recipient must always be
 * able to opt out (CAN-SPAM/GDPR), regardless of flag state or auth; the signed
 * token is the only credential it needs.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../../../src/types/env.js';
import { requireOrgFlag, notFound, type AppCtx } from '../../../src/lib/feature_guard.js';
import { dbExecute } from '../../../src/services/db.js';
import {
  FLAG_KEY,
  loadCampaign,
  estimateRecipients,
  sendCampaign,
  type CampaignRow,
} from './service.js';
import { verifyUnsubToken } from './unsubscribe.js';

type AppContext = { Bindings: Env; Variables: Variables };

export const emailMarketing = new Hono<AppContext>();

/**
 * Auth + flag (shared guard) + campaign-ownership gate.
 * @returns The owned `{ campaign, orgId }`, or a short-circuit `Response`.
 */
async function gate(c: AppCtx): Promise<{ campaign: CampaignRow; orgId: string } | Response> {
  const g = await requireOrgFlag(c, FLAG_KEY);
  if (g instanceof Response) return g;
  const campaign = await loadCampaign(c.env, c.req.param('id'));
  if (!campaign || campaign.org_id !== g.orgId) return notFound(c);
  return { campaign, orgId: g.orgId };
}

emailMarketing.get('/api/marketing/campaigns/:id/recipients', async (c) => {
  const g = await gate(c);
  if (g instanceof Response) return g;
  const count = await estimateRecipients(c.env, g.orgId, g.campaign.site_id);
  return c.json(count);
});

emailMarketing.post('/api/marketing/campaigns/:id/send', async (c) => {
  const g = await gate(c);
  if (g instanceof Response) return g;
  const result = await sendCampaign(c.env, g.campaign);
  return c.json(result);
});

/** Minimal branded confirmation page for the public unsubscribe flow. */
const unsubPage = (msg: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
  `<meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribe</title></head>` +
  `<body style="font:16px/1.6 system-ui,sans-serif;background:#060610;color:#f4f4ff;display:grid;place-items:center;min-height:100vh;margin:0">` +
  `<main style="max-width:32rem;padding:2rem;text-align:center"><h1 style="color:#00e5ff;font-size:1.25rem">Email preferences</h1>` +
  `<p>${msg}</p></main></body></html>`;

// PUBLIC + NOT flag-gated — unsubscribe must always work (legal). The signed
// token is the only credential; a bad/forged token returns 400, never mutates.
emailMarketing.get('/api/marketing/unsubscribe', async (c) => {
  const u = c.req.query('u') ?? '';
  const s = c.req.query('s') ?? '';
  const tok = await verifyUnsubToken(c.env, u, s);
  if (!tok) return c.html(unsubPage('This unsubscribe link is invalid or has expired.'), 400);

  // Best-effort across both audiences; failures must not surface to the recipient.
  await dbExecute(
    c.env.DB,
    `UPDATE newsletter_subscribers SET unsubscribed = 1 WHERE site_id = ? AND lower(email) = lower(?)`,
    [tok.siteId, tok.email],
  ).catch(() => undefined);
  await dbExecute(
    c.env.DB,
    `UPDATE contacts SET consent_email = 0, updated_at = datetime('now') WHERE site_id = ? AND lower(email) = lower(?)`,
    [tok.siteId, tok.email],
  ).catch(() => undefined);

  return c.html(
    unsubPage(
      "You've been unsubscribed. You won't receive further marketing emails from this site.",
    ),
  );
});
