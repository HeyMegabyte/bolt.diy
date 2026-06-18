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
 * `dry-run → confirm → idempotent PaymentIntent → audit`.
 *
 * Two sibling tools complete the constrained surface, each behind the SAME flag
 * + auth + tenant-binding gate ({@link gateAiPaymentAction}):
 *  - `POST /api/ai-actions/payment-refund` — refund a prior charge via
 *    {@link refundPayment} (caller-owned idempotency key; both outcomes audited).
 *  - `GET /api/ai-actions/payment-status/:paymentIntentId` — read-only status via
 *    {@link getPaymentStatus} (moves no money, writes no audit).
 *  - `GET /api/ai-actions/payment-methods?customer=cus_…` — list a customer's
 *    saved cards (masked) via {@link listSavedPaymentMethods}.
 *  - `GET /api/ai-actions/customers?q=cus_…|email` — resolve a customer via
 *    {@link lookupCustomer}, so the agent can discover the `cus_…`/`pm_…` refs a
 *    charge/refund needs without ever handling a raw card.
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import type { Env, Variables } from '../types/env.js';
import { isFlagOn } from '../modules/feature_flags/services.js';
import { assessPaymentCommand } from '../services/ai_payment_command.js';
import {
  executeAuthorizedPaymentCommand,
  stripeOffSessionCharge,
  refundPayment,
  getPaymentStatus,
  stripeRefund,
  stripeGetPaymentStatus,
  type ExecAuditEntry,
} from '../services/ai_payment_execute.js';
import {
  listSavedPaymentMethods,
  lookupCustomer,
  stripeListPaymentMethods,
  stripeLookupCustomer,
} from '../services/ai_payment_lookup.js';
import { writeAuditLog } from '../services/audit.js';

/** Feature flag gating the whole surface — dark-launched (default off). */
export const AI_PAYMENT_COMMAND_FLAG = 'ai_payment_command';

export const aiActions = new Hono<{ Bindings: Env; Variables: Variables }>();

/** A refund command — `amount_cents` absent/null = full refund. */
const RefundCommandRequestSchema = z
  .object({
    payment_intent_id: z.string().min(1).max(120),
    amount_cents: z.number().int().positive().nullable().optional(),
    idempotency_key: z.string().min(8).max(120),
    site_id: z.string().min(1).max(120).optional(),
    reason: z.string().max(300).optional(),
  })
  .strict();

type GateCtx = Context<{ Bindings: Env; Variables: Variables }>;

/**
 * Shared transport gate for every AI payment action: auth-required (401 when
 * anonymous) + flag-gated (404 — never 403, never leak existence). Returns the
 * resolved session identity, or a short-circuit Response to return as-is.
 */
async function gateAiPaymentAction(
  c: GateCtx,
): Promise<
  | { ok: true; userId: string; orgId: string | undefined; requestId: string | undefined }
  | { ok: false; res: Response }
> {
  const userId = c.get('userId');
  const orgId = c.get('orgId');
  const requestId = c.get('requestId');

  if (!userId) {
    return {
      ok: false,
      res: c.json(
        {
          error: {
            code: 'UNAUTHORIZED',
            message: 'Must be authenticated to issue a payment command.',
            request_id: requestId,
          },
        },
        401,
      ),
    };
  }
  if (!(await isFlagOn(c.env, AI_PAYMENT_COMMAND_FLAG, { orgId, userId }))) {
    return {
      ok: false,
      res: c.json(
        { error: { code: 'NOT_FOUND', message: 'Not found.', request_id: requestId } },
        404,
      ),
    };
  }
  return { ok: true, userId, orgId, requestId };
}

aiActions.post('/api/ai-actions/payment-command', async (c) => {
  const gate = await gateAiPaymentAction(c);
  if (!gate.ok) return gate.res;
  const { userId, orgId, requestId } = gate;

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

/**
 * `POST /api/ai-actions/payment-refund` — refund a prior payment-command charge
 * via the constrained {@link refundPayment} tool. Same transport posture as the
 * charge path: auth-required, flag-gated, tenant bound to the SESSION org, body
 * Zod-validated → `validation_error`. The caller supplies the `idempotency_key`
 * and reuses it on retry so a retried refund dedupes at Stripe (caller-owns-key
 * model). `amount_cents` absent/null = full refund. Both outcomes are audited.
 */
aiActions.post('/api/ai-actions/payment-refund', async (c) => {
  const gate = await gateAiPaymentAction(c);
  if (!gate.ok) return gate.res;
  const { userId, orgId, requestId } = gate;

  const parsed = RefundCommandRequestSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json(
      {
        error: {
          code: 'validation_error',
          message: parsed.error.issues[0]?.message ?? 'Invalid refund request.',
          request_id: requestId,
        },
      },
      400,
    );
  }
  const req = parsed.data;

  const outcome = await refundPayment(
    {
      paymentIntentId: req.payment_intent_id,
      amountCents: req.amount_cents ?? null,
      idempotencyKey: req.idempotency_key,
      tenantId: orgId ?? '',
      siteId: req.site_id ?? '',
      reason: req.reason ?? null,
    },
    {
      refund: stripeRefund(c.env),
      audit: async (entry: ExecAuditEntry) => {
        await writeAuditLog(c.env.DB, {
          org_id: orgId ?? '',
          actor_id: userId,
          action: entry.action,
          message: `Payment refund ${entry.outcome}: ${(entry.amountCents / 100).toFixed(2)} ${entry.currency.toUpperCase()} on ${entry.paymentMethodRef}`,
          target_type: 'payment_command',
          ...(entry.siteId ? { target_id: entry.siteId } : {}),
          metadata_json: {
            amount_cents: entry.amountCents,
            currency: entry.currency,
            payment_intent_id: entry.paymentMethodRef,
            outcome: entry.outcome,
            idempotency_key: entry.idempotencyKey,
            ...(entry.detail ? { detail: entry.detail } : {}),
          },
          ...(requestId ? { request_id: requestId } : {}),
        });
      },
    },
  );

  if (!outcome.ok) {
    // A Stripe-side refund failure is 402; a precondition miss is 400.
    const status = outcome.code === 'refund_failed' ? 402 : 400;
    return c.json(
      { error: { code: outcome.code, message: outcome.message, request_id: requestId } },
      status,
    );
  }

  return c.json({
    data: {
      stage: 'refunded',
      refund_id: outcome.refundId,
      status: outcome.status,
      idempotency_key: req.idempotency_key,
    },
  });
});

/**
 * `GET /api/ai-actions/payment-status/:paymentIntentId` — read the live status
 * of a prior payment-command charge via the read-only {@link getPaymentStatus}
 * tool. Auth-required + flag-gated like the others; read-only, so it moves no
 * money and writes no audit. Invalid id → 400; an unavailable lookup → 404.
 */
aiActions.get('/api/ai-actions/payment-status/:paymentIntentId', async (c) => {
  const gate = await gateAiPaymentAction(c);
  if (!gate.ok) return gate.res;
  const { requestId } = gate;

  const outcome = await getPaymentStatus(c.req.param('paymentIntentId'), {
    getStatus: stripeGetPaymentStatus(c.env),
  });

  if (!outcome.ok) {
    const status = outcome.code === 'status_unavailable' ? 404 : 400;
    return c.json(
      { error: { code: outcome.code, message: outcome.message, request_id: requestId } },
      status,
    );
  }

  return c.json({
    data: {
      payment_intent_id: outcome.paymentIntentId,
      status: outcome.status,
      ...(outcome.amountCents !== undefined ? { amount_cents: outcome.amountCents } : {}),
    },
  });
});

/**
 * `GET /api/ai-actions/payment-methods?customer=cus_…` — list a customer's saved
 * cards (masked brand/last4/expiry only — never a PAN) via the read-only
 * {@link listSavedPaymentMethods} tool. Auth + flag gated; moves no money,
 * writes no audit. Invalid customer → 400; an upstream Stripe failure → 502.
 */
aiActions.get('/api/ai-actions/payment-methods', async (c) => {
  const gate = await gateAiPaymentAction(c);
  if (!gate.ok) return gate.res;
  const { requestId } = gate;

  const outcome = await listSavedPaymentMethods(c.req.query('customer') ?? '', {
    list: stripeListPaymentMethods(c.env),
  });
  if (!outcome.ok) {
    const status = outcome.code === 'lookup_failed' ? 502 : 400;
    return c.json(
      { error: { code: outcome.code, message: outcome.message, request_id: requestId } },
      status,
    );
  }
  return c.json({ data: { payment_methods: outcome.methods } });
});

/**
 * `GET /api/ai-actions/customers?q=cus_…|email` — resolve a customer by id or
 * email via the read-only {@link lookupCustomer} tool, so an agent can find the
 * `cus_…` ref a charge/refund needs. Auth + flag gated; read-only, no audit.
 * Non-id/non-email query → 400; an upstream Stripe failure → 502.
 */
aiActions.get('/api/ai-actions/customers', async (c) => {
  const gate = await gateAiPaymentAction(c);
  if (!gate.ok) return gate.res;
  const { requestId } = gate;

  const outcome = await lookupCustomer(c.req.query('q') ?? '', stripeLookupCustomer(c.env));
  if (!outcome.ok) {
    const status = outcome.code === 'lookup_failed' ? 502 : 400;
    return c.json(
      { error: { code: outcome.code, message: outcome.message, request_id: requestId } },
      status,
    );
  }
  return c.json({ data: { customers: outcome.customers } });
});
