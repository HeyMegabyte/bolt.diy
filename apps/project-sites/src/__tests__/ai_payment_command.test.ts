import {
  assessPaymentCommand,
  containsRawCardNumber,
  parsePaymentCommand,
} from '../services/ai_payment_command';

/**
 * #4 AI payment-command safety model — the pure policy layer.
 *
 * The safety contract (every one of these is a build-fail if it regresses):
 *   - NEVER accept a raw card number (PAN) in the command text.
 *   - NEVER charge by a last-4 hint alone — a saved payment-method ref is required.
 *   - amount is mandatory + must be a positive integer-cents value.
 *   - a customer/payment-method reference is mandatory.
 *   - dry_run is the DEFAULT — a live charge requires an explicit, intent-bound
 *     confirmation token; a wrong/absent token never charges.
 * The endpoint + MCP tool layer (later slices) consume this; it touches no
 * Stripe/D1/network so every reject path is unit-provable here.
 */

const baseReq = {
  tenant_id: 'tenant_test',
  site_id: 'site_test',
  command: 'Charge $50',
  payment_method_ref: 'pm_123',
  customer_hint: 'Brian',
  reason: 'invoice #42',
};

describe('containsRawCardNumber', () => {
  it('flags a 16-digit PAN', () => {
    expect(containsRawCardNumber('charge 4242424242424242 for $50')).toBe(true);
  });
  it('flags a PAN with spaces or dashes', () => {
    expect(containsRawCardNumber('card 4242 4242 4242 4242')).toBe(true);
    expect(containsRawCardNumber('card 4242-4242-4242-4242')).toBe(true);
  });
  it('flags a 13-19 digit run (Amex 15, etc.)', () => {
    expect(containsRawCardNumber('378282246310005')).toBe(true);
  });
  it('does NOT flag a 4-digit last4 hint', () => {
    expect(containsRawCardNumber('Charge CC4242 for $50')).toBe(false);
  });
  it('does NOT flag an amount or a short id', () => {
    expect(containsRawCardNumber('charge $50 ref 42')).toBe(false);
    expect(containsRawCardNumber('pm_1234567')).toBe(false);
  });
});

describe('parsePaymentCommand — amount + reject paths', () => {
  it('parses "$50" → 5000 cents, usd default', () => {
    const r = parsePaymentCommand('Charge $50', { paymentMethodRef: 'pm_1' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.intent.amountCents).toBe(5000);
      expect(r.intent.currency).toBe('usd');
    }
  });
  it('parses "$50.00" and "50 dollars" → 5000 cents', () => {
    expect(
      (
        parsePaymentCommand('pay $50.00', { paymentMethodRef: 'pm_1' }) as {
          intent: { amountCents: number };
        }
      ).intent.amountCents,
    ).toBe(5000);
    expect(
      (
        parsePaymentCommand('pay 50 dollars', { paymentMethodRef: 'pm_1' }) as {
          intent: { amountCents: number };
        }
      ).intent.amountCents,
    ).toBe(5000);
  });
  it('rejects a raw card number', () => {
    const r = parsePaymentCommand('charge 4242424242424242 for $50', { paymentMethodRef: 'pm_1' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('raw_card_forbidden');
  });
  it('rejects a last4-only reference with no saved PM', () => {
    const r = parsePaymentCommand('Charge CC4242 for $50', {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('last4_only_forbidden');
  });
  it('rejects a missing amount', () => {
    const r = parsePaymentCommand('charge the customer', { paymentMethodRef: 'pm_1' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('amount_required');
  });
  it('rejects a zero / negative amount', () => {
    const r = parsePaymentCommand('charge $0', { paymentMethodRef: 'pm_1' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('amount_invalid');
  });
  it('rejects when no payment-method reference can be resolved', () => {
    const r = parsePaymentCommand('charge $50', {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('payment_method_required');
  });
});

describe('assessPaymentCommand — Zod + dry-run/confirm policy engine', () => {
  it('rejects a malformed request (missing tenant_id) before any parsing', () => {
    const r = assessPaymentCommand({
      command: 'Charge $50',
      site_id: 's',
      payment_method_ref: 'pm_1',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('validation_error');
  });

  it('dry_run (default) returns a preview + confirmation token, never authorizes', () => {
    const r = assessPaymentCommand(baseReq); // dry_run defaults true
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.stage).toBe('dry_run');
      expect(r.confirmation_required).toBe(true);
      expect(typeof r.confirmation_token).toBe('string');
      expect(r.confirmation_token.length).toBeGreaterThan(0);
      expect(r.preview.amountCents).toBe(5000);
    }
  });

  it('a live charge with NO confirmation token is rejected (never charges)', () => {
    const r = assessPaymentCommand({ ...baseReq, dry_run: false });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('confirmation_required');
  });

  it('a live charge with a WRONG confirmation token is rejected', () => {
    const r = assessPaymentCommand({ ...baseReq, dry_run: false, confirmation_token: 'cnf_bogus' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('confirmation_invalid');
  });

  it('a live charge with the matching token authorizes + yields an idempotency key', () => {
    const dry = assessPaymentCommand(baseReq);
    expect(dry.ok).toBe(true);
    if (!dry.ok || dry.stage !== 'dry_run') throw new Error('expected dry_run');
    const live = assessPaymentCommand({
      ...baseReq,
      dry_run: false,
      confirmation_token: dry.confirmation_token,
    });
    expect(live.ok).toBe(true);
    if (live.ok && live.stage === 'authorized') {
      expect(live.intent.amountCents).toBe(5000);
      expect(live.idempotency_key.length).toBeGreaterThan(0);
    } else {
      throw new Error('expected authorized');
    }
  });

  it('the confirmation token + idempotency key are intent-bound + stable (same intent → same keys)', () => {
    const a = assessPaymentCommand(baseReq);
    const b = assessPaymentCommand(baseReq);
    if (a.ok && b.ok && a.stage === 'dry_run' && b.stage === 'dry_run') {
      expect(a.confirmation_token).toBe(b.confirmation_token);
    }
    // a different amount must produce a different token (no confirm-swapping).
    const c = assessPaymentCommand({ ...baseReq, command: 'Charge $99' });
    if (a.ok && c.ok && a.stage === 'dry_run' && c.stage === 'dry_run') {
      expect(c.confirmation_token).not.toBe(a.confirmation_token);
    }
  });

  it('still enforces the raw-card / last4 / amount rejects through the policy entry', () => {
    expect(
      (assessPaymentCommand({ ...baseReq, command: 'charge 4242424242424242' }) as { code: string })
        .code,
    ).toBe('raw_card_forbidden');
    expect(
      (
        assessPaymentCommand({
          ...baseReq,
          command: 'Charge CC4242',
          payment_method_ref: undefined,
        }) as { code: string }
      ).code,
    ).toBe('last4_only_forbidden');
  });
});
