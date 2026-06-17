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
 * A dry-run (the default) returns a preview + an intent-bound confirmation token
 * and moves no money. A live command (`dry_run:false` + the matching token) is an
 * explicit, confirmed authorization — it executes via the constrained tool
 * ({@link executeAuthorizedPaymentCommand}, idempotency key passed through) and
 * the attempt is audited to D1. Per the ledger flow:
 * `dry-run → confirm → idempotent PaymentIntent → audit`. (refund / get_status
 * are the remaining tools.)
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { isFlagOn } from '../modules/feature_flags/services.js';
import { assessPaymentCommand } from '../services/ai_payment_command.js';
import {
  executeAuthorizedPaymentCommand,
  stripeOffSessionCharge,
  type ExecAuditEntry,
} from '../services/ai_payment_execute.js';
import { writeAuditLog } from '../services/audit.js';

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
  // Authorized = a live command with a matching, intent-bound confirmation token.
  // The token IS the explicit opt-in to charge, so execute it now via the
  // constrained tool (idempotency key passed through → retries dedupe at Stripe).
  const exec = await executeAuthorizedPaymentCommand(result.intent, result.idempotency_key, {
    charge: stripeOffSessionCharge(c.env),
    audit: async (entry: ExecAuditEntry) => {
      // Best-effort D1 audit; writeAuditLog already swallows its own errors, and
      // the executor's safeAudit wraps this — a logging miss never blocks a charge.
      await writeAuditLog(c.env.DB, {
        org_id: orgId ?? '',
        actor_id: userId,
        action: entry.action,
        message: `Payment command ${entry.outcome}: ${(entry.amountCents / 100).toFixed(2)} ${entry.currency.toUpperCase()} via ${entry.paymentMethodRef}`,
        target_type: 'payment_command',
        ...(entry.siteId ? { target_id: entry.siteId } : {}),
        metadata_json: {
          amount_cents: entry.amountCents,
          currency: entry.currency,
          payment_method_ref: entry.paymentMethodRef,
          outcome: entry.outcome,
          idempotency_key: entry.idempotencyKey,
          ...(entry.paymentIntentId ? { payment_intent_id: entry.paymentIntentId } : {}),
        },
        ...(requestId ? { request_id: requestId } : {}),
      });
    },
  });

  if (!exec.ok) {
    // A declined / failed charge is 402 Payment Required; a precondition miss is 400.
    const status = exec.code === 'charge_failed' ? 402 : 400;
    return c.json(
      { error: { code: exec.code, message: exec.message, request_id: requestId } },
      status,
    );
  }

  return c.json({
    data: {
      stage: 'charged',
      payment_intent_id: exec.paymentIntentId,
      status: exec.status,
      idempotency_key: result.idempotency_key,
    },
  });
});
