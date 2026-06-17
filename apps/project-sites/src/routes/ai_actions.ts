/**
 * ai_actions — the AI payment-command HTTP surface (safety-gated).
 *
 * `POST /api/ai-actions/payment-command` turns a natural-language payment
 * instruction into a constrained, audited decision via the pure policy layer
 * {@link assessPaymentCommand}. This route adds the transport-tier guards the
 * pure layer can't:
 *  - **Auth required** — 401 when there's no authenticated user.
 *  - **Flag-gated** — `ai_payment_command` (default off) → 404 (never 403, never
 *    leak the endpoint's existence) when disabled.
 *  - **Tenant binding** — `tenant_id` is taken from the authenticated session
 *    (`orgId`), NEVER from the client body, so a caller can't issue a command
 *    against another tenant.
 *  - **Reject → envelope** — every policy reject maps to a 400 with the exact
 *    stable reject `code` (`raw_card_forbidden`, `confirmation_required`, …) +
 *    `request_id`, the documented error shape.
 *
 * This route NEVER moves money: a dry-run returns a preview + confirmation token;
 * an authorized result returns the audited intent + idempotency key with
 * `executed: false`. The actual charge (constrained MCP Stripe tool) + the D1
 * audit write are the next slices, sequenced after the PaymentIntent per the
 * ledger (`dry-run → confirm → PaymentIntent → audit → receipt → refund`).
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { isFlagOn } from '../modules/feature_flags/services.js';
import { assessPaymentCommand } from '../services/ai_payment_command.js';

/** Feature flag gating the whole surface — dark-launched (default off). */
export const AI_PAYMENT_COMMAND_FLAG = 'ai_payment_command';

export const aiActions = new Hono<{ Bindings: Env; Variables: Variables }>();

aiActions.post('/api/ai-actions/payment-command', async (c) => {
  const userId = c.get('userId');
  const orgId = c.get('orgId');
  const requestId = c.get('requestId');

  // Auth — a payment command is never anonymous.
  if (!userId) {
    return c.json(
      {
        error: {
          code: 'UNAUTHORIZED',
          message: 'Must be authenticated to issue a payment command.',
          request_id: requestId,
        },
      },
      401,
    );
  }

  // Flag gate — 404 (not 403) when off so the endpoint's existence isn't leaked.
  if (!(await isFlagOn(c.env, AI_PAYMENT_COMMAND_FLAG, { orgId, userId }))) {
    return c.json(
      { error: { code: 'NOT_FOUND', message: 'Not found.', request_id: requestId } },
      404,
    );
  }

  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

  // Tenant binding: the org is the authenticated session's, NEVER the client's
  // — a missing org therefore fails Zod validation (can't charge without a tenant).
  const result = assessPaymentCommand({ ...body, tenant_id: orgId });

  if (!result.ok) {
    return c.json(
      { error: { code: result.code, message: result.message, request_id: requestId } },
      400,
    );
  }

  // Success: a decision, NOT a charge. Execution (Stripe tool) is a later slice.
  if (result.stage === 'dry_run') {
    return c.json({
      data: {
        stage: 'dry_run',
        preview: result.preview,
        confirmation_required: true,
        confirmation_token: result.confirmation_token,
      },
    });
  }
  return c.json({
    data: {
      stage: 'authorized',
      intent: result.intent,
      idempotency_key: result.idempotency_key,
      executed: false,
      note: 'Authorized — charge execution (Stripe) is not yet wired.',
    },
  });
});
