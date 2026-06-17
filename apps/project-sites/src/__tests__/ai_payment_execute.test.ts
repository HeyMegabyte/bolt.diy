import { executeAuthorizedPaymentCommand } from '../services/ai_payment_execute';
import type { NormalizedIntent } from '../services/ai_payment_command';

/**
 * #4 constrained execution tool — runs an ALREADY-AUTHORIZED intent against
 * Stripe via injected deps (charge + audit), so every guard is unit-provable
 * with zero network/D1. The safety contract this locks:
 *  - only a saved payment-method ref ever reaches Stripe (never raw card data).
 *  - an idempotency key is MANDATORY (a retried command must dedupe, not
 *    double-charge) and is passed THROUGH to the charge call.
 *  - a positive integer-cents amount.
 *  - BOTH outcomes are audited (success + failure), and a successful charge is
 *    still reported even if the audit write throws (charge truth > log truth).
 */

const intent: NormalizedIntent = {
  tenantId: 'org_1',
  siteId: 'site_1',
  amountCents: 5000,
  currency: 'usd',
  paymentMethodRef: 'pm_123',
  customerHint: 'Brian',
  reason: 'invoice #42',
};

function deps(overrides: Partial<{ charge: jest.Mock; audit: jest.Mock }> = {}) {
  return {
    charge:
      overrides.charge ??
      jest.fn().mockResolvedValue({ paymentIntentId: 'pi_abc', status: 'succeeded' }),
    audit: overrides.audit ?? jest.fn().mockResolvedValue(undefined),
  };
}

describe('executeAuthorizedPaymentCommand', () => {
  it('rejects a missing idempotency key (never charge without dedupe protection)', async () => {
    const d = deps();
    const r = await executeAuthorizedPaymentCommand(intent, '', d);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('idempotency_key_required');
    expect(d.charge).not.toHaveBeenCalled();
  });

  it('rejects a non-saved payment-method ref (raw card / last4 can never reach Stripe)', async () => {
    const d = deps();
    const r = await executeAuthorizedPaymentCommand(
      { ...intent, paymentMethodRef: '4242424242424242' },
      'idem_1',
      d,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid_payment_method');
    expect(d.charge).not.toHaveBeenCalled();
  });

  it('rejects a non-positive amount', async () => {
    const d = deps();
    const r = await executeAuthorizedPaymentCommand({ ...intent, amountCents: 0 }, 'idem_1', d);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('amount_invalid');
    expect(d.charge).not.toHaveBeenCalled();
  });

  it('charges with the idempotency key passed through, returns the PaymentIntent, audits success', async () => {
    const d = deps();
    const r = await executeAuthorizedPaymentCommand(intent, 'idem_xyz', d);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.paymentIntentId).toBe('pi_abc');
      expect(r.status).toBe('succeeded');
    }
    expect(d.charge).toHaveBeenCalledTimes(1);
    expect(d.charge).toHaveBeenCalledWith(
      expect.objectContaining({
        amountCents: 5000,
        currency: 'usd',
        paymentMethodRef: 'pm_123',
        idempotencyKey: 'idem_xyz',
      }),
    );
    expect(d.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'succeeded',
        amountCents: 5000,
        paymentMethodRef: 'pm_123',
      }),
    );
  });

  it('on a Stripe failure returns charge_failed + audits the failure', async () => {
    const d = deps({ charge: jest.fn().mockRejectedValue(new Error('card_declined')) });
    const r = await executeAuthorizedPaymentCommand(intent, 'idem_1', d);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('charge_failed');
    expect(d.audit).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'failed' }));
  });

  it('still reports a successful charge even if the audit write throws', async () => {
    const d = deps({ audit: jest.fn().mockRejectedValue(new Error('d1 down')) });
    const r = await executeAuthorizedPaymentCommand(intent, 'idem_1', d);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.paymentIntentId).toBe('pi_abc');
  });
});
