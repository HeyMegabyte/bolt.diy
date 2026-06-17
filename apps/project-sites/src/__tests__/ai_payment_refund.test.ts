import { refundPayment, getPaymentStatus } from '../services/ai_payment_execute';

/**
 * #4 constrained tools — `refund` + `get_status`, the read/reverse half of the
 * MCP payment tool surface. Dependency-injected (no network/D1) so every guard
 * is unit-provable. Same safety posture as the charge executor: idempotency on
 * the mutating refund, typed rejects, both outcomes audited.
 */

function refundDeps(overrides: Partial<{ refund: jest.Mock; audit: jest.Mock }> = {}) {
  return {
    refund:
      overrides.refund ?? jest.fn().mockResolvedValue({ refundId: 're_1', status: 'succeeded' }),
    audit: overrides.audit ?? jest.fn().mockResolvedValue(undefined),
  };
}

const baseRefund = {
  paymentIntentId: 'pi_abc',
  amountCents: 5000,
  idempotencyKey: 'idem_r1',
  tenantId: 'org_1',
  siteId: 'site_1',
  reason: 'customer refund',
};

describe('refundPayment', () => {
  it('rejects a missing / non-pi payment-intent id', async () => {
    const d = refundDeps();
    const r = await refundPayment({ ...baseRefund, paymentIntentId: '4242' }, d);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid_payment_intent');
    expect(d.refund).not.toHaveBeenCalled();
  });

  it('rejects a missing idempotency key (a retried refund must dedupe)', async () => {
    const d = refundDeps();
    const r = await refundPayment({ ...baseRefund, idempotencyKey: '' }, d);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('idempotency_key_required');
    expect(d.refund).not.toHaveBeenCalled();
  });

  it('rejects a non-positive partial amount (null = full refund is allowed)', async () => {
    const d = refundDeps();
    const r = await refundPayment({ ...baseRefund, amountCents: 0 }, d);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('amount_invalid');
  });

  it('allows a full refund when amountCents is null, passing the idempotency key through', async () => {
    const d = refundDeps();
    const r = await refundPayment({ ...baseRefund, amountCents: null }, d);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.refundId).toBe('re_1');
    expect(d.refund).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: 'idem_r1', amountCents: null }),
    );
    expect(d.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'payment_command.refunded', outcome: 'succeeded' }),
    );
  });

  it('on a Stripe failure returns refund_failed + audits the failure', async () => {
    const d = refundDeps({ refund: jest.fn().mockRejectedValue(new Error('already_refunded')) });
    const r = await refundPayment(baseRefund, d);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('refund_failed');
    expect(d.audit).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'failed' }));
  });
});

describe('getPaymentStatus', () => {
  it('rejects a non-pi id', async () => {
    const r = await getPaymentStatus('nope', { getStatus: jest.fn() });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid_payment_intent');
  });

  it('returns the live status for a valid pi id (read-only, no audit needed)', async () => {
    const getStatus = jest
      .fn()
      .mockResolvedValue({ paymentIntentId: 'pi_abc', status: 'succeeded', amountCents: 5000 });
    const r = await getPaymentStatus('pi_abc', { getStatus });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.status).toBe('succeeded');
      expect(r.amountCents).toBe(5000);
    }
  });

  it('maps a lookup failure to status_unavailable', async () => {
    const getStatus = jest.fn().mockRejectedValue(new Error('not_found'));
    const r = await getPaymentStatus('pi_abc', { getStatus });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('status_unavailable');
  });
});
