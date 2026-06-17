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
  readonly action: 'payment_command.executed';
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

async function safeAudit(deps: ExecuteDeps, entry: ExecAuditEntry): Promise<void> {
  try {
    await deps.audit(entry);
  } catch {
    /* audit is best-effort — never let it break the charge report */
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
