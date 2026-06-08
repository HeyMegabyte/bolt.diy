/**
 * Route-LAYER coverage for routes/wallet.ts — the 4 wallet test files (75 cases)
 * are all SERVICE-level (zero hit `/api/wallet/*`), so the 5 route handlers were
 * untested. Exercises every handler + branch through a Hono app wired with the
 * real `errorHandler` (so `throw unauthorized()` → 401 faithfully) + auth-context
 * injection; the wallet service + D1 helpers are mocked at their boundaries.
 *
 *   GET  /api/wallet              401 · 200
 *   POST /api/wallet/subscribe    401 · invalid-body 400 · checkout-fail 400 · 200
 *   POST /api/wallet/topup        401 · amount clamp (default/min/max/passthrough)
 *   GET  /api/wallet/transactions 401 · 200 (+ days clamp to 365)
 *   GET  /api/wallet/cost-categories  200 (public, no auth)
 */

jest.mock('../services/wallet.js', () => ({
  getWalletState: jest.fn(),
  startSubscription: jest.fn(),
  topUpWallet: jest.fn(),
}));
jest.mock('../services/db.js', () => ({ dbQuery: jest.fn(), dbQueryOne: jest.fn() }));

import { Hono } from 'hono';
import { wallet } from '../routes/wallet.js';
import { errorHandler } from '../middleware/error_handler.js';
import { getWalletState, startSubscription, topUpWallet } from '../services/wallet.js';
import { dbQuery, dbQueryOne } from '../services/db.js';

const mState = getWalletState as jest.MockedFunction<typeof getWalletState>;
const mSub = startSubscription as jest.MockedFunction<typeof startSubscription>;
const mTopup = topUpWallet as jest.MockedFunction<typeof topUpWallet>;
const mDbQuery = dbQuery as jest.MockedFunction<typeof dbQuery>;
const mDbOne = dbQueryOne as jest.MockedFunction<typeof dbQueryOne>;

function app(ids?: { orgId?: string; userId?: string }) {
  const a = new Hono();
  a.onError(errorHandler);
  a.use('*', async (c, next) => {
    if (ids?.orgId) c.set('orgId' as never, ids.orgId as never);
    if (ids?.userId) c.set('userId' as never, ids.userId as never);
    c.set('requestId' as never, 'test-req' as never);
    await next();
  });
  a.route('/', wallet);
  return a;
}
const authed = () => app({ orgId: 'org1', userId: 'u1' });
const env = {} as never;
const jsonReq = (b: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });

beforeEach(() => {
  jest.clearAllMocks();
  mDbQuery.mockResolvedValue({ data: [] } as never);
  mDbOne.mockResolvedValue(null as never);
});

describe('GET /api/wallet', () => {
  it('401 when org context is missing', async () => {
    expect((await app().request('/api/wallet', {}, env)).status).toBe(401);
  });

  it('200 returns the wallet state', async () => {
    mState.mockResolvedValue({ balance_cents: 5000 } as never);
    const res = await authed().request('/api/wallet', {}, env);
    expect(res.status).toBe(200);
    expect((await res.json() as { balance_cents: number }).balance_cents).toBe(5000);
  });
});

describe('POST /api/wallet/subscribe', () => {
  it('401 when unauthenticated', async () => {
    expect((await app().request('/api/wallet/subscribe', jsonReq({ return_url: 'https://x/y' }), env)).status).toBe(401);
  });

  it('400 on an invalid return_url (zValidator)', async () => {
    expect((await authed().request('/api/wallet/subscribe', jsonReq({ return_url: 'not-a-url' }), env)).status).toBe(400);
  });

  it('400 when the upstream checkout fails', async () => {
    mSub.mockResolvedValue({ ok: false, message: 'card declined' } as never);
    const res = await authed().request('/api/wallet/subscribe', jsonReq({ return_url: 'https://x/y' }), env);
    expect(res.status).toBe(400);
    expect((await res.json() as { error: { code: string } }).error.code).toBe('CHECKOUT_FAILED');
  });

  it('200 returns the checkout_url on success', async () => {
    mDbOne.mockResolvedValue({ email: 'u@x.com' } as never);
    mSub.mockResolvedValue({ ok: true, checkout_url: 'https://stripe/cs_1' } as never);
    const res = await authed().request('/api/wallet/subscribe', jsonReq({ return_url: 'https://x/y' }), env);
    expect(res.status).toBe(200);
    expect((await res.json() as { checkout_url: string }).checkout_url).toBe('https://stripe/cs_1');
  });
});

describe('POST /api/wallet/topup (amount clamp)', () => {
  beforeEach(() => mTopup.mockResolvedValue({ ok: true } as never));
  const amountFor = async (body: unknown): Promise<number> => {
    await authed().request('/api/wallet/topup', jsonReq(body), env);
    return mTopup.mock.calls[0][2] as number;
  };

  it('401 when unauthenticated', async () => {
    expect((await app().request('/api/wallet/topup', jsonReq({}), env)).status).toBe(401);
  });

  it('defaults to 5000 when amount_cents is unset (or 0)', async () => {
    expect(await amountFor({})).toBe(5000);
  });

  it('clamps below-minimum up to 100', async () => {
    expect(await amountFor({ amount_cents: 50 })).toBe(100);
  });

  it('clamps above-maximum down to 50000', async () => {
    expect(await amountFor({ amount_cents: 99999 })).toBe(50000);
  });

  it('passes a valid in-range amount through', async () => {
    expect(await amountFor({ amount_cents: 2000 })).toBe(2000);
  });
});

describe('GET /api/wallet/transactions', () => {
  it('401 when unauthenticated', async () => {
    expect((await app().request('/api/wallet/transactions', {}, env)).status).toBe(401);
  });

  it('200 returns the ledger', async () => {
    mDbQuery.mockResolvedValue({ data: [{ id: 't1' }] } as never);
    const res = await authed().request('/api/wallet/transactions', {}, env);
    expect(res.status).toBe(200);
    expect((await res.json() as { transactions: unknown[] }).transactions).toHaveLength(1);
  });

  it('clamps days to 365', async () => {
    await authed().request('/api/wallet/transactions?days=999', {}, env);
    // 3rd bind param is the `-<days> days` window expression
    expect(mDbQuery.mock.calls[0][2]).toEqual(['org1', '-365 days']);
  });
});

describe('GET /api/wallet/cost-categories (public)', () => {
  it('200 returns the billable catalog without auth', async () => {
    mDbQuery.mockResolvedValue({ data: [{ slug: 'ai_call' }] } as never);
    const res = await app().request('/api/wallet/cost-categories', {}, env);
    expect(res.status).toBe(200);
    expect((await res.json() as { categories: unknown[] }).categories).toHaveLength(1);
  });
});
