/**
 * services/donations — handleDonationCheckout records a completed Stripe donation
 * into `donations`, resolve-or-creates the site's campaign, bumps aggregates, and is
 * idempotent on stripe_payment_id. db mocked (returns the real { error } contract).
 */
jest.mock('../services/db.js', () => ({
  dbInsert: jest.fn(async () => ({ error: null })),
  dbQueryOne: jest.fn(async () => null),
  dbExecute: jest.fn(async () => ({ error: null, changes: 1 })),
}));

import { handleDonationCheckout, type DonationSession } from '../services/donations.js';
import { dbInsert, dbQueryOne, dbExecute } from '../services/db.js';
import type { Env } from '../types/env.js';

const mInsert = dbInsert as unknown as jest.Mock;
const mQueryOne = dbQueryOne as unknown as jest.Mock;
const mExecute = dbExecute as unknown as jest.Mock;

const env = { DB: {} } as unknown as Env;

function session(over: Partial<DonationSession> = {}): DonationSession {
  return {
    id: 'cs_test_1',
    amount_total: 2500,
    mode: 'payment',
    customer_details: { email: 'donor@example.com' },
    payment_intent: 'pi_test_1',
    metadata: { kind: 'donation', site_id: 'site-1', amount_cents: '2500', donor_name: 'Jane' },
    ...over,
  };
}

beforeEach(() => {
  mInsert.mockReset().mockResolvedValue({ error: null });
  mQueryOne.mockReset().mockResolvedValue(null);
  mExecute.mockReset().mockResolvedValue({ error: null, changes: 1 });
});

describe('handleDonationCheckout', () => {
  it('creates a campaign (first donation) + inserts the donation + bumps aggregates', async () => {
    mQueryOne.mockResolvedValueOnce(null).mockResolvedValueOnce(null); // no dup, no campaign yet
    await handleDonationCheckout(env, session());
    expect(mInsert.mock.calls.map((c) => c[1])).toEqual(['donation_campaigns', 'donations']);
    const donationRow = mInsert.mock.calls.find((c) => c[1] === 'donations')![2];
    expect(donationRow).toMatchObject({
      amount_cents: 2500,
      donor_email: 'donor@example.com',
      recurring: 0,
      anonymous: 0,
      stripe_payment_id: 'pi_test_1',
    });
    expect(mExecute).toHaveBeenCalledWith(
      env.DB,
      expect.stringContaining('UPDATE donation_campaigns SET raised_cents = raised_cents + ?'),
      [2500, expect.any(String)],
    );
  });

  it('reuses an existing campaign (does not create a new one)', async () => {
    mQueryOne.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'camp-existing' });
    await handleDonationCheckout(env, session());
    expect(mInsert.mock.calls.map((c) => c[1])).toEqual(['donations']);
    expect(mInsert.mock.calls[0][2].campaign_id).toBe('camp-existing');
  });

  it('is idempotent — skips when the payment is already recorded', async () => {
    mQueryOne.mockResolvedValueOnce({ id: 'don-existing' });
    await handleDonationCheckout(env, session());
    expect(mInsert).not.toHaveBeenCalled();
    expect(mExecute).not.toHaveBeenCalled();
  });

  it('skips (no insert) when site_id metadata is missing', async () => {
    await handleDonationCheckout(env, session({ metadata: { kind: 'donation' } }));
    expect(mInsert).not.toHaveBeenCalled();
  });

  it('skips a zero/negative amount', async () => {
    await handleDonationCheckout(
      env,
      session({ amount_total: 0, metadata: { kind: 'donation', site_id: 's1' } }),
    );
    expect(mInsert).not.toHaveBeenCalled();
  });

  it('marks recurring + anonymous and falls back to metadata.amount_cents when amount_total is null', async () => {
    mQueryOne.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'c1' });
    await handleDonationCheckout(
      env,
      session({
        amount_total: null,
        mode: 'subscription',
        metadata: { kind: 'donation', site_id: 's1', amount_cents: '5000', donor_name: 'Anonymous' },
      }),
    );
    const donationRow = mInsert.mock.calls.find((c) => c[1] === 'donations')![2];
    expect(donationRow).toMatchObject({ amount_cents: 5000, recurring: 1, anonymous: 1 });
  });
});
