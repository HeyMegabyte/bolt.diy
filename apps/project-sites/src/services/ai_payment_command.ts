/**
 * AI payment-command safety model — the pure policy layer.
 *
 * @remarks
 * Interprets a natural-language payment instruction ("Charge $50 for invoice
 * #42") into a constrained, auditable {@link NormalizedIntent} — WITHOUT ever
 * touching a card number. This module is deliberately pure (no Stripe, D1,
 * network, or clock): the endpoint + the constrained MCP tool layer
 * (`lookup_customer` / `list_saved_payment_methods` / `create_payment_intent` /
 * `confirm_payment_intent` / `refund` / `get_status`) are built ON TOP of it, so
 * every safety reject path is unit-provable here.
 *
 * The non-negotiable safety contract:
 *  1. **Never accept a raw card number (PAN)** in the command text.
 *  2. **Never charge by a last-4 hint alone** — a saved `payment_method_ref`
 *     (`pm_…` / `card_…`) must be supplied; the last-4 is only ever a hint.
 *  3. **Amount is mandatory** and must be a positive integer-cents value.
 *  4. **A customer / payment-method reference is mandatory.**
 *  5. **dry-run is the DEFAULT.** A live charge requires an explicit
 *     confirmation token that is *bound to the exact intent* — a wrong or absent
 *     token never authorizes (no confirm-swapping a $5 preview into a $5,000
 *     charge).
 *
 * @example
 * ```ts
 * const preview = assessPaymentCommand({ tenant_id, site_id, command: 'Charge $50',
 *   payment_method_ref: 'pm_123', reason: 'invoice #42' });
 * // → { ok:true, stage:'dry_run', confirmation_required:true, confirmation_token }
 * const charge = assessPaymentCommand({ ...same, dry_run:false,
 *   confirmation_token: preview.confirmation_token });
 * // → { ok:true, stage:'authorized', intent, idempotency_key }
 * ```
 */
import { z } from 'zod';

/** Reasons a command is refused — stable codes for audit + UI mapping. */
export type RejectCode =
  | 'validation_error'
  | 'raw_card_forbidden'
  | 'last4_only_forbidden'
  | 'amount_required'
  | 'amount_invalid'
  | 'payment_method_required'
  | 'confirmation_required'
  | 'confirmation_invalid';

/** A fully-resolved, charge-ready intent (still no card data — only a PM ref). */
export interface NormalizedIntent {
  readonly tenantId: string;
  readonly siteId: string;
  readonly amountCents: number;
  readonly currency: string;
  readonly paymentMethodRef: string;
  readonly customerHint: string | null;
  readonly reason: string | null;
}

/** Outcome of {@link parsePaymentCommand}. */
export type ParseResult =
  | { ok: true; intent: NormalizedIntent }
  | { ok: false; code: RejectCode; message: string };

/** Outcome of {@link assessPaymentCommand} — the policy engine entry point. */
export type PaymentCommandResult =
  | {
      ok: true;
      stage: 'dry_run';
      preview: NormalizedIntent;
      confirmation_required: true;
      confirmation_token: string;
    }
  | { ok: true; stage: 'authorized'; intent: NormalizedIntent; idempotency_key: string }
  | { ok: false; code: RejectCode; message: string };

/**
 * Request envelope. `dry_run` defaults to `true` — the safe default: a caller
 * must opt INTO a live charge AND supply a matching confirmation token.
 */
export const PaymentCommandRequestSchema = z
  .object({
    tenant_id: z.string().min(1),
    site_id: z.string().min(1),
    command: z.string().min(1).max(500),
    payment_method_ref: z.string().min(1).max(120).optional(),
    customer_hint: z.string().max(200).optional(),
    currency: z.string().length(3).optional(),
    reason: z.string().max(300).optional(),
    dry_run: z.boolean().default(true),
    confirmation_token: z.string().max(120).optional(),
  })
  .strict();

export type PaymentCommandRequest = z.infer<typeof PaymentCommandRequestSchema>;

/** Luhn check — a valid PAN checksum strengthens the raw-card signal. */
function luhnValid(digits: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

/**
 * Detect a raw card number (PAN) anywhere in the text. A run of 13-19 digits
 * (optionally grouped by single spaces or dashes) is treated as a card and
 * refused — Luhn-valid or not, because the rule is "no raw card numbers ever",
 * not "no valid card numbers". A 4-digit last-4 hint is NOT a PAN.
 *
 * @param text - The natural-language command.
 * @returns `true` when a card-number-shaped token is present.
 */
export function containsRawCardNumber(text: string): boolean {
  // Grouped form: 4242 4242 4242 4242 / 4242-4242-4242-4242 (13-19 digits total).
  const grouped = text.match(/\b(?:\d[ -]?){13,19}\b/g) ?? [];
  for (const g of grouped) {
    const digits = g.replace(/[ -]/g, '');
    if (digits.length >= 13 && digits.length <= 19) return true;
  }
  // Bare run of 13-19 digits.
  const bare = text.match(/\b\d{13,19}\b/g) ?? [];
  for (const b of bare) if (luhnValid(b) || b.length >= 13) return true;
  return false;
}

/** Whether a ref is a real saved payment-method id (not a card / last-4). */
function isSavedPmRef(ref: string | undefined): ref is string {
  return !!ref && /^(pm_|card_|src_|ba_)[A-Za-z0-9]+$/.test(ref);
}

/** Detect a "charge by last-4" pattern (CC4242, "ending in 4242", "card 4242"). */
function mentionsLast4(text: string): boolean {
  return /\b(?:cc|card(?:\s+ending(?:\s+in)?)?|ending(?:\s+in)?)\s*#?\s*\d{4}\b/i.test(text);
}

/** Pull the first money value (cents) out of the command, if any. */
function extractAmountCents(text: string): number | null {
  // $50 / $50.00 / 50 dollars / 50 usd
  const m = text.match(
    /\$\s*(\d+(?:\.\d{1,2})?)|\b(\d+(?:\.\d{1,2})?)\s*(?:dollars?|usd|eur|gbp)\b/i,
  );
  if (!m) return null;
  const raw = m[1] ?? m[2];
  if (raw === undefined) return null;
  const dollars = Number(raw);
  if (!Number.isFinite(dollars)) return null;
  return Math.round(dollars * 100);
}

/** Detect the currency mentioned, defaulting to usd. */
function extractCurrency(text: string, explicit?: string): string {
  if (explicit) return explicit.toLowerCase();
  if (/€|\beur\b/i.test(text)) return 'eur';
  if (/£|\bgbp\b/i.test(text)) return 'gbp';
  return 'usd';
}

/**
 * Parse a command string into a {@link NormalizedIntent} or a typed reject.
 *
 * @param command - The natural-language instruction.
 * @param ctx - Structured context: the resolved `paymentMethodRef`, optional
 *   `customerHint` / `currency` / `reason` / `tenantId` / `siteId`.
 * @returns A {@link ParseResult}.
 */
export function parsePaymentCommand(
  command: string,
  ctx: {
    paymentMethodRef?: string;
    customerHint?: string;
    currency?: string;
    reason?: string;
    tenantId?: string;
    siteId?: string;
  },
): ParseResult {
  // Rule 1 — raw PAN is an immediate, unconditional refusal.
  if (containsRawCardNumber(command)) {
    return {
      ok: false,
      code: 'raw_card_forbidden',
      message: 'A raw card number is never accepted. Use a saved payment method.',
    };
  }
  // Rule 2 — last-4 alone, with no saved PM ref, cannot identify a card safely.
  if (!isSavedPmRef(ctx.paymentMethodRef) && mentionsLast4(command)) {
    return {
      ok: false,
      code: 'last4_only_forbidden',
      message:
        'A card cannot be charged by its last 4 digits alone — select a saved payment method.',
    };
  }
  // Rule 3 — amount must be present and positive.
  const amountCents = extractAmountCents(command);
  if (amountCents === null) {
    return {
      ok: false,
      code: 'amount_required',
      message: 'No amount was specified. State an explicit amount, e.g. "$50".',
    };
  }
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    return { ok: false, code: 'amount_invalid', message: 'The amount must be a positive value.' };
  }
  // Rule 4 — a saved payment-method reference is required to charge anything.
  if (!isSavedPmRef(ctx.paymentMethodRef)) {
    return {
      ok: false,
      code: 'payment_method_required',
      message: 'A saved payment method is required before a charge can be prepared.',
    };
  }
  return {
    ok: true,
    intent: {
      tenantId: ctx.tenantId ?? '',
      siteId: ctx.siteId ?? '',
      amountCents,
      currency: extractCurrency(command, ctx.currency),
      paymentMethodRef: ctx.paymentMethodRef,
      customerHint: ctx.customerHint ?? null,
      reason: ctx.reason ?? null,
    },
  };
}

/** Canonical string of the charge identity — drives both derived keys. */
function canonicalIntent(i: NormalizedIntent): string {
  return [i.tenantId, i.siteId, i.amountCents, i.currency, i.paymentMethodRef, i.reason ?? ''].join(
    '|',
  );
}

/** Stable, dependency-free hash (djb2) → hex. Deterministic for the same intent. */
function stableHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, '0');
}

/** Confirmation token bound to the exact intent (prevents confirm-swapping). */
function confirmationToken(i: NormalizedIntent): string {
  return `cnf_${stableHash('confirm|' + canonicalIntent(i))}`;
}

/** Idempotency key — stable per (tenant, site, amount, currency, PM, reason). */
function idempotencyKey(i: NormalizedIntent): string {
  return `idem_${stableHash('idem|' + canonicalIntent(i))}`;
}

/**
 * Policy-engine entry point: validate → parse → apply the dry-run/confirm gate.
 *
 * @param rawRequest - The untrusted request body (Zod-validated here).
 * @returns A {@link PaymentCommandResult}: a dry-run preview (default), an
 *   authorized intent (when a matching confirmation token is supplied), or a
 *   typed reject. NEVER performs a charge — it only produces the audited,
 *   confirmed intent the constrained Stripe tool then executes.
 * @throws Never — all failures are returned as `{ ok:false, code }`.
 */
export function assessPaymentCommand(rawRequest: unknown): PaymentCommandResult {
  const parsed = PaymentCommandRequestSchema.safeParse(rawRequest);
  if (!parsed.success) {
    return {
      ok: false,
      code: 'validation_error',
      message: parsed.error.issues[0]?.message ?? 'Invalid request.',
    };
  }
  const req = parsed.data;

  const result = parsePaymentCommand(req.command, {
    paymentMethodRef: req.payment_method_ref,
    customerHint: req.customer_hint,
    currency: req.currency,
    reason: req.reason,
    tenantId: req.tenant_id,
    siteId: req.site_id,
  });
  if (!result.ok) return result;

  const intent = result.intent;

  // Safe default: a dry-run returns a preview + the intent-bound token to echo.
  if (req.dry_run) {
    return {
      ok: true,
      stage: 'dry_run',
      preview: intent,
      confirmation_required: true,
      confirmation_token: confirmationToken(intent),
    };
  }

  // Live path: an explicit, matching confirmation token is mandatory.
  if (!req.confirmation_token) {
    return {
      ok: false,
      code: 'confirmation_required',
      message: 'A live charge requires a confirmation token from a prior dry-run.',
    };
  }
  if (req.confirmation_token !== confirmationToken(intent)) {
    return {
      ok: false,
      code: 'confirmation_invalid',
      message: 'The confirmation token does not match this exact charge — re-confirm the dry-run.',
    };
  }

  return { ok: true, stage: 'authorized', intent, idempotency_key: idempotencyKey(intent) };
}
