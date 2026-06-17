/**
 * AI payment-command — the constrained EXECUTION tool.
 *
 * @remarks
 * Runs an already-AUTHORIZED {@link NormalizedIntent} (one that cleared
 * {@link assessPaymentCommand}'s dry-run → confirmation gate) against Stripe.
 * The Stripe call and the audit write are INJECTED ({@link ExecuteDeps}) so the
 * whole safety contract is unit-provable with no network or D1:
 *
 *  - **Saved payment-method ref only** — a `pm_/card_/src_/ba_` id ever reaches
 *    Stripe; a raw card number or a bare last-4 is refused here too (defence in
 *    depth — the policy layer already refused it, this never trusts that alone).
 *  - **Idempotency key mandatory** — a retried command must dedupe at Stripe,
 *    not double-charge; the key is passed THROUGH to the charge call.
 *  - **Both outcomes audited** — success AND failure are recorded; a successful
 *    charge is still reported even if the audit write throws (the money moved —
 *    losing the log can't un-move it, so we never report a real charge as failed).
 *
 * This is the executor behind the constrained MCP tool surface
 * (`create_payment_intent` / `confirm_payment_intent`). The route calls it only
 * with an `assessPaymentCommand` `authorized` result + its idempotency key.
 */
import type { NormalizedIntent } from './ai_payment_command.js';
import type { Env } from '../types/env.js';

/** A single off-session charge request handed to the Stripe seam. */
export interface ChargeRequest {
  readonly amountCents: number;
  readonly currency: string;
  readonly paymentMethodRef: string;
  readonly customerRef: string | null;
  readonly idempotencyKey: string;
  readonly tenantId: string;
  readonly siteId: string;
  readonly reason: string | null;
}

/** What the Stripe seam returns on a created/confirmed PaymentIntent. */
export interface ChargeResult {
  readonly paymentIntentId: string;
  readonly status: string;
}

/** An audit record for a payment-command execution attempt (no card data). */
export interface ExecAuditEntry {
  readonly action: 'payment_command.executed' | 'payment_command.refunded';
  readonly tenantId: string;
  readonly siteId: string;
  readonly amountCents: number;
  readonly currency: string;
  readonly paymentMethodRef: string;
  readonly idempotencyKey: string;
  readonly outcome: 'succeeded' | 'failed';
  readonly paymentIntentId?: string;
  readonly detail?: string;
}

/** Injected side-effects — real in prod, mocked in tests. */
export interface ExecuteDeps {
  charge: (req: ChargeRequest) => Promise<ChargeResult>;
  audit: (entry: ExecAuditEntry) => Promise<void>;
}

/** Result of an execution attempt. */
export type ExecuteResult =
  | { ok: true; paymentIntentId: string; status: string }
  | {
      ok: false;
      code:
        | 'idempotency_key_required'
        | 'invalid_payment_method'
        | 'amount_invalid'
        | 'charge_failed';
      message: string;
    };

const SAVED_PM = /^(pm_|card_|src_|ba_)[A-Za-z0-9]+$/;

/**
 * Execute an authorized payment-command intent. Never charges unless every
 * precondition holds; always audits the attempt.
 *
 * @param intent - The authorized, charge-ready intent.
 * @param idempotencyKey - The intent-bound key from the authorized assess result.
 * @param deps - Injected `charge` (Stripe) + `audit` (D1) side-effects.
 * @returns A typed {@link ExecuteResult}; never throws.
 */
export async function executeAuthorizedPaymentCommand(
  intent: NormalizedIntent,
  idempotencyKey: string,
  deps: ExecuteDeps,
): Promise<ExecuteResult> {
  // Guard — idempotency is non-negotiable; a retry must dedupe, not double-charge.
  if (!idempotencyKey) {
    return {
      ok: false,
      code: 'idempotency_key_required',
      message: 'An idempotency key is required before a charge can run.',
    };
  }
  // Guard — only a saved payment-method id may reach Stripe (defence in depth).
  if (!SAVED_PM.test(intent.paymentMethodRef)) {
    return {
      ok: false,
      code: 'invalid_payment_method',
      message: 'Only a saved payment method (pm_/card_/src_/ba_) can be charged.',
    };
  }
  // Guard — positive integer cents.
  if (!Number.isInteger(intent.amountCents) || intent.amountCents <= 0) {
    return {
      ok: false,
      code: 'amount_invalid',
      message: 'The amount must be a positive integer-cents value.',
    };
  }

  const req: ChargeRequest = {
    amountCents: intent.amountCents,
    currency: intent.currency,
    paymentMethodRef: intent.paymentMethodRef,
    customerRef: intent.customerHint,
    idempotencyKey,
    tenantId: intent.tenantId,
    siteId: intent.siteId,
    reason: intent.reason,
  };

  let result: ChargeResult;
  try {
    result = await deps.charge(req);
  } catch (err) {
    await safeAudit(deps, baseAudit(intent, idempotencyKey, 'failed', { detail: errMessage(err) }));
    return { ok: false, code: 'charge_failed', message: 'The charge could not be completed.' };
  }

  // Money moved — record it, but never let an audit failure flip a real charge
  // to a reported failure (that would be the worst possible lie on this surface).
  await safeAudit(
    deps,
    baseAudit(intent, idempotencyKey, 'succeeded', { paymentIntentId: result.paymentIntentId }),
  );
  return { ok: true, paymentIntentId: result.paymentIntentId, status: result.status };
}

function baseAudit(
  i: NormalizedIntent,
  idempotencyKey: string,
  outcome: 'succeeded' | 'failed',
  extra: { paymentIntentId?: string; detail?: string },
): ExecAuditEntry {
  return {
    action: 'payment_command.executed',
    tenantId: i.tenantId,
    siteId: i.siteId,
    amountCents: i.amountCents,
    currency: i.currency,
    paymentMethodRef: i.paymentMethodRef,
    idempotencyKey,
    outcome,
    ...(extra.paymentIntentId ? { paymentIntentId: extra.paymentIntentId } : {}),
    ...(extra.detail ? { detail: extra.detail } : {}),
  };
}

async function safeAudit(
  deps: { audit: (entry: ExecAuditEntry) => Promise<void> },
  entry: ExecAuditEntry,
): Promise<void> {
  try {
    await deps.audit(entry);
  } catch {
    /* audit is best-effort — never let it break the charge/refund report */
  }
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'unknown_error';
}

/**
 * Production Stripe seam — an off-session charge against a SAVED payment method,
 * idempotency key on the request header so retries dedupe at Stripe. Thin
 * adapter (no business logic); the executor above owns every guard.
 *
 * @param env - Worker env carrying `STRIPE_SECRET_KEY`.
 * @returns A {@link ExecuteDeps.charge} implementation.
 */
export function stripeOffSessionCharge(env: Env): ExecuteDeps['charge'] {
  return async (req: ChargeRequest): Promise<ChargeResult> => {
    const params = new URLSearchParams({
      amount: String(req.amountCents),
      currency: req.currency,
      payment_method: req.paymentMethodRef,
      confirm: 'true',
      off_session: 'true',
      'metadata[org_id]': req.tenantId,
      'metadata[site_id]': req.siteId,
    });
    if (req.customerRef) params.append('metadata[customer_hint]', req.customerRef);
    if (req.reason) params.append('description', req.reason);

    const res = await fetch('https://api.stripe.com/v1/payment_intents', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Idempotency-Key': req.idempotencyKey,
      },
      body: params,
    });
    const json = (await res.json()) as {
      id?: string;
      status?: string;
      error?: { message?: string };
    };
    if (!res.ok || !json.id) {
      throw new Error(json.error?.message ?? `stripe_error_${res.status}`);
    }
    return { paymentIntentId: json.id, status: json.status ?? 'unknown' };
  };
}

const PAYMENT_INTENT = /^pi_[A-Za-z0-9]+$/;

/** A refund request — `amountCents: null` means a full refund. */
export interface RefundRequest {
  readonly paymentIntentId: string;
  readonly amountCents: number | null;
  readonly idempotencyKey: string;
  readonly tenantId: string;
  readonly siteId: string;
  readonly reason: string | null;
}

/** What the Stripe refund seam returns. */
export interface RefundResult {
  readonly refundId: string;
  readonly status: string;
}

/** Injected deps for {@link refundPayment}. */
export interface RefundDeps {
  refund: (req: RefundRequest) => Promise<RefundResult>;
  audit: (entry: ExecAuditEntry) => Promise<void>;
}

export type RefundOutcome =
  | { ok: true; refundId: string; status: string }
  | {
      ok: false;
      code:
        | 'invalid_payment_intent'
        | 'idempotency_key_required'
        | 'amount_invalid'
        | 'refund_failed';
      message: string;
    };

/**
 * Refund a prior payment-command charge. Same safety posture as the charge
 * executor: a valid `pi_` id, a mandatory idempotency key (passed through so a
 * retried refund dedupes), a positive partial amount when given (`null` = full),
 * and both outcomes audited.
 *
 * @param req - The refund request.
 * @param deps - Injected `refund` (Stripe) + `audit` (D1).
 * @returns A {@link RefundOutcome}; never throws.
 */
export async function refundPayment(req: RefundRequest, deps: RefundDeps): Promise<RefundOutcome> {
  if (!PAYMENT_INTENT.test(req.paymentIntentId)) {
    return {
      ok: false,
      code: 'invalid_payment_intent',
      message: 'A valid payment-intent id (pi_…) is required to refund.',
    };
  }
  if (!req.idempotencyKey) {
    return {
      ok: false,
      code: 'idempotency_key_required',
      message: 'An idempotency key is required before a refund can run.',
    };
  }
  if (req.amountCents !== null && (!Number.isInteger(req.amountCents) || req.amountCents <= 0)) {
    return {
      ok: false,
      code: 'amount_invalid',
      message:
        'A partial refund amount must be a positive integer-cents value (or null for a full refund).',
    };
  }

  let result: RefundResult;
  try {
    result = await deps.refund(req);
  } catch (err) {
    await safeAudit(deps, refundAudit(req, 'failed', { detail: errMessage(err) }));
    return { ok: false, code: 'refund_failed', message: 'The refund could not be completed.' };
  }
  await safeAudit(deps, refundAudit(req, 'succeeded', { paymentIntentId: req.paymentIntentId }));
  return { ok: true, refundId: result.refundId, status: result.status };
}

function refundAudit(
  req: RefundRequest,
  outcome: 'succeeded' | 'failed',
  extra: { paymentIntentId?: string; detail?: string },
): ExecAuditEntry {
  return {
    action: 'payment_command.refunded',
    tenantId: req.tenantId,
    siteId: req.siteId,
    amountCents: req.amountCents ?? 0,
    currency: 'usd',
    paymentMethodRef: req.paymentIntentId,
    idempotencyKey: req.idempotencyKey,
    outcome,
    ...(extra.paymentIntentId ? { paymentIntentId: extra.paymentIntentId } : {}),
    ...(extra.detail ? { detail: extra.detail } : {}),
  };
}

/** Read-only status of a PaymentIntent. */
export type StatusOutcome =
  | { ok: true; paymentIntentId: string; status: string; amountCents?: number }
  | { ok: false; code: 'invalid_payment_intent' | 'status_unavailable'; message: string };

/** Injected dep for {@link getPaymentStatus}. */
export interface StatusDeps {
  getStatus: (
    paymentIntentId: string,
  ) => Promise<{ paymentIntentId: string; status: string; amountCents?: number }>;
}

/**
 * Read the live status of a prior payment-command charge. Read-only → no audit.
 *
 * @param paymentIntentId - The `pi_…` id to look up.
 * @param deps - Injected `getStatus` (Stripe).
 * @returns A {@link StatusOutcome}; never throws.
 */
export async function getPaymentStatus(
  paymentIntentId: string,
  deps: StatusDeps,
): Promise<StatusOutcome> {
  if (!PAYMENT_INTENT.test(paymentIntentId)) {
    return {
      ok: false,
      code: 'invalid_payment_intent',
      message: 'A valid payment-intent id (pi_…) is required.',
    };
  }
  try {
    const s = await deps.getStatus(paymentIntentId);
    return {
      ok: true,
      paymentIntentId: s.paymentIntentId,
      status: s.status,
      ...(s.amountCents !== undefined ? { amountCents: s.amountCents } : {}),
    };
  } catch {
    return {
      ok: false,
      code: 'status_unavailable',
      message: 'The payment status could not be retrieved.',
    };
  }
}

/** Production Stripe refund seam (idempotency key on the header). */
export function stripeRefund(env: Env): RefundDeps['refund'] {
  return async (req: RefundRequest): Promise<RefundResult> => {
    const params = new URLSearchParams({ payment_intent: req.paymentIntentId });
    if (req.amountCents !== null) params.append('amount', String(req.amountCents));
    if (req.reason) params.append('metadata[reason]', req.reason);
    const res = await fetch('https://api.stripe.com/v1/refunds', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Idempotency-Key': req.idempotencyKey,
      },
      body: params,
    });
    const json = (await res.json()) as {
      id?: string;
      status?: string;
      error?: { message?: string };
    };
    if (!res.ok || !json.id) throw new Error(json.error?.message ?? `stripe_error_${res.status}`);
    return { refundId: json.id, status: json.status ?? 'unknown' };
  };
}

/** Production Stripe PaymentIntent-status seam (read-only). */
export function stripeGetPaymentStatus(env: Env): StatusDeps['getStatus'] {
  return async (paymentIntentId: string) => {
    const res = await fetch(
      `https://api.stripe.com/v1/payment_intents/${encodeURIComponent(paymentIntentId)}`,
      {
        headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
      },
    );
    const json = (await res.json()) as {
      id?: string;
      status?: string;
      amount?: number;
      error?: { message?: string };
    };
    if (!res.ok || !json.id) throw new Error(json.error?.message ?? `stripe_error_${res.status}`);
    return {
      paymentIntentId: json.id,
      status: json.status ?? 'unknown',
      ...(typeof json.amount === 'number' ? { amountCents: json.amount } : {}),
    };
  };
}
