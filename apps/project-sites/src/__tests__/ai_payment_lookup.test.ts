import { listSavedPaymentMethods, lookupCustomer } from '../services/ai_payment_lookup';

/**
 * #4 AI payment-command — the constrained READ-ONLY discovery tools. These let
 * an agent resolve a customer + a SAVED payment-method ref (a `pm_…`) BEFORE
 * issuing a charge — never a raw PAN, only the masked brand/last4/expiry Stripe
 * itself returns. Read-only → no money movement, no audit. The Stripe seam is
 * injected so every guard is unit-provable with no network.
 */

describe('listSavedPaymentMethods', () => {
  it('rejects a non-customer ref with invalid_customer (no Stripe call)', async () => {
    const list = jest.fn();
    const r = await listSavedPaymentMethods('not_a_customer', { list });
    expect(r).toEqual({ ok: false, code: 'invalid_customer', message: expect.any(String) });
    expect(list).not.toHaveBeenCalled();
  });

  it('returns the masked saved methods for a valid customer', async () => {
    const list = jest
      .fn()
      .mockResolvedValue([
        { id: 'pm_1', brand: 'visa', last4: '4242', expMonth: 12, expYear: 2030 },
      ]);
    const r = await listSavedPaymentMethods('cus_abc', { list });
    expect(r).toEqual({
      ok: true,
      methods: [{ id: 'pm_1', brand: 'visa', last4: '4242', expMonth: 12, expYear: 2030 }],
    });
    expect(list).toHaveBeenCalledWith('cus_abc');
  });

  it('maps a Stripe failure to lookup_failed (never throws)', async () => {
    const list = jest.fn().mockRejectedValue(new Error('stripe_error_500'));
    const r = await listSavedPaymentMethods('cus_abc', { list });
    expect(r).toEqual({ ok: false, code: 'lookup_failed', message: expect.any(String) });
  });
});

describe('lookupCustomer', () => {
  const deps = () => ({ byId: jest.fn(), byEmail: jest.fn() });

  it('resolves a cus_ id via byId → single match', async () => {
    const d = deps();
    d.byId.mockResolvedValue({ id: 'cus_x', email: 'a@b.com', name: 'A' });
    const r = await lookupCustomer('cus_x', d);
    expect(r).toEqual({ ok: true, customers: [{ id: 'cus_x', email: 'a@b.com', name: 'A' }] });
    expect(d.byId).toHaveBeenCalledWith('cus_x');
    expect(d.byEmail).not.toHaveBeenCalled();
  });

  it('a cus_ id with no match resolves to an empty list (not an error)', async () => {
    const d = deps();
    d.byId.mockResolvedValue(null);
    const r = await lookupCustomer('cus_missing', d);
    expect(r).toEqual({ ok: true, customers: [] });
  });

  it('resolves an email via byEmail (lower-cased)', async () => {
    const d = deps();
    d.byEmail.mockResolvedValue([{ id: 'cus_y', email: 'x@y.com', name: null }]);
    const r = await lookupCustomer('  X@Y.com ', d);
    expect(r).toEqual({ ok: true, customers: [{ id: 'cus_y', email: 'x@y.com', name: null }] });
    expect(d.byEmail).toHaveBeenCalledWith('x@y.com');
    expect(d.byId).not.toHaveBeenCalled();
  });

  it('rejects a non-id, non-email query with invalid_query (no Stripe call)', async () => {
    const d = deps();
    const r = await lookupCustomer('just some words', d);
    expect(r).toEqual({ ok: false, code: 'invalid_query', message: expect.any(String) });
    expect(d.byId).not.toHaveBeenCalled();
    expect(d.byEmail).not.toHaveBeenCalled();
  });

  it('maps a Stripe failure to lookup_failed (never throws)', async () => {
    const d = deps();
    d.byEmail.mockRejectedValue(new Error('boom'));
    const r = await lookupCustomer('a@b.com', d);
    expect(r).toEqual({ ok: false, code: 'lookup_failed', message: expect.any(String) });
  });
});
