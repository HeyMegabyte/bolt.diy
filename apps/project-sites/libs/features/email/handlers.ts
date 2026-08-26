/**
 * @module libs/features/email/handlers
 *
 * @description
 * Hono routes for the transactional-email surface — the weekly-digest lifecycle
 * endpoints: the public one-click unsubscribe link shipped in every digest, and
 * the authenticated org-scoped manual digest trigger (preview-on-demand). The
 * unsubscribe route is intentionally public (the link lands in an inbox with no
 * session) and is guarded by a signed token verified via `verifyUnsubscribeToken`;
 * the trigger route is org-scoped via `c.get('orgId')` (401 envelope when missing).
 *
 * | Method | Path                        | Auth   | Purpose                              |
 * | ------ | --------------------------- | ------ | ------------------------------------ |
 * | GET    | /api/email/unsubscribe      | public | Signed-token one-click opt-out (HTML)|
 * | POST   | /api/email/digest/trigger   | orgId  | Manually send digests to all orgs    |
 *
 * Extracted VERBATIM from the `api.ts` monolith (route-decomposition installment
 * 6). No request body is cast via `as {…}` — the unsubscribe token comes from
 * `c.req.query('token')` and the trigger takes no body — so there is no
 * `schemas.ts` (nothing to Zod-validate at the boundary). The unsubscribe route
 * resolves the org from the token then flips `orgs.digest_opt_out` via a direct
 * `c.env.DB.prepare(...)` write; the trigger delegates to the same
 * `sendWeeklyDigestsForAllOrgs` cron entrypoint. Known AppErrors (`unauthorized()`)
 * propagate to the app-level error handler.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import { unauthorized } from '@project-sites/shared';
import type { Env, Variables } from '../../../src/types/env.js';
import {
  sendWeeklyDigestsForAllOrgs,
  verifyUnsubscribeToken,
} from '../../../src/services/weekly_digest.js';

type AppContext = { Bindings: Env; Variables: Variables };

export const email = new Hono<AppContext>();

/**
 * @route GET /api/email/unsubscribe?token=<signed>
 * @public — one-click unsubscribe link shipped in every weekly digest.
 * @returns HTML confirmation page; 400 on invalid token.
 */
email.get('/api/email/unsubscribe', async (c) => {
  const token = c.req.query('token') || '';
  if (!token) {
    return c.html('<html><body><h1>Missing token</h1></body></html>', 400);
  }
  const secret =
    c.env.WEEKLY_DIGEST_SECRET ?? c.env.STRIPE_WEBHOOK_SECRET ?? 'weekly-digest-fallback';
  const orgId = await verifyUnsubscribeToken(token, secret);
  if (!orgId) {
    return c.html('<html><body><h1>Invalid or expired token</h1></body></html>', 400);
  }
  await c.env.DB.prepare('UPDATE orgs SET digest_opt_out = 1, updated_at = ? WHERE id = ?')
    .bind(new Date().toISOString(), orgId)
    .run();

  return c.html(
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Unsubscribed</title>
     <style>body{background:#060610;color:#e2e8f0;font-family:-apple-system,sans-serif;
       display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;}
       .card{background:rgba(255,255,255,0.03);border:1px solid rgba(0,229,255,0.18);
       border-radius:14px;padding:32px 36px;text-align:center;max-width:480px;}
       h1{color:#00E5FF;margin:0 0 8px;font-size:22px;} p{color:#94a3b8;margin:0;}</style>
     </head><body><div class="card"><h1>You're unsubscribed</h1>
     <p>We won't send you any more weekly digest emails for this organization.</p>
     </div></body></html>`,
    200,
  );
});

/**
 * @route POST /api/email/digest/trigger
 * @description Admin-only manual trigger — exposes the cron entrypoint behind
 *   the same authenticated org boundary so an org owner can preview the digest
 *   on demand.
 * @auth Bearer — orgId required.
 */
email.post('/api/email/digest/trigger', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized('Must be authenticated');
  const result = await sendWeeklyDigestsForAllOrgs(c.env);
  return c.json({ data: result });
});
