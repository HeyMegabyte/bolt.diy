import { Hono } from 'hono';
import { aiActions } from '../routes/ai_actions';
import { isFlagOn } from '../modules/feature_flags/services.js';

/**
 * #4 AI payment-command — the read-only discovery routes' transport guards
 * (auth-401, flag-404, executor outcome → status/envelope). The executors'
 * guards live in ai_payment_lookup.test.ts; here the executor + Stripe seam are
 * mocked so no network is touched.
 */
jest.mock('../modules/feature_flags/services.js', () => ({ isFlagOn: jest.fn() }));
jest.mock('../services/ai_payment_execute.js', () => ({
  executeAuthorizedPaymentCommand: jest.fn(),
  stripeOffSessionCharge: jest.fn(() => jest.fn()),
  refundPayment: jest.fn(),
  getPaymentStatus: jest.fn(),
  stripeRefund: jest.fn(() => jest.fn()),
  stripeGetPaymentStatus: jest.fn(() => jest.fn()),
}));
jest.mock('../services/ai_payment_lookup.js', () => ({
  listSavedPaymentMethods: jest.fn(),
  lookupCustomer: jest.fn(),
  stripeListPaymentMethods: jest.fn(() => jest.fn()),
  stripeLookupCustomer: jest.fn(() => ({ byId: jest.fn(), byEmail: jest.fn() })),
}));
jest.mock('../services/audit.js', () => ({
  writeAuditLog: jest.fn().mockResolvedValue(undefined),
}));

const mockIsFlagOn = isFlagOn as jest.MockedFunction<typeof isFlagOn>;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const lookupMod = require('../services/ai_payment_lookup.js');
const mockListPm = lookupMod.listSavedPaymentMethods as jest.Mock;
const mockLookup = lookupMod.lookupCustomer as jest.Mock;

function makeApp(auth: { userId?: string; orgId?: string }) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    if (auth.userId) c.set('userId', auth.userId);
    if (auth.orgId) c.set('orgId', auth.orgId);
    c.set('requestId', 'req_test');
    await next();
  });
  app.route('/', aiActions);
  return app;
}

const get = (app: Hono, path: string) => app.request(path, { method: 'GET' }, {} as never);

describe('GET /api/ai-actions/payment-methods', () => {
  beforeEach(() => {
    mockIsFlagOn.mockReset();
    mockListPm.mockReset();
  });

  it('401s when unauthenticated', async () => {
    const res = await get(makeApp({}), '/api/ai-actions/payment-methods?customer=cus_a');
    expect(res.status).toBe(401);
    expect(mockListPm).not.toHaveBeenCalled();
  });

  it('404s (not 403) when the flag is off', async () => {
    mockIsFlagOn.mockResolvedValue(false);
    const res = await get(
      makeApp({ userId: 'u1', orgId: 'o1' }),
      '/api/ai-actions/payment-methods?customer=cus_a',
    );
    expect(res.status).toBe(404);
    expect(mockListPm).not.toHaveBeenCalled();
  });

  it('ok → 200 with the masked methods', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    mockListPm.mockResolvedValue({
      ok: true,
      methods: [{ id: 'pm_1', brand: 'visa', last4: '4242', expMonth: 1, expYear: 2031 }],
    });
    const res = await get(
      makeApp({ userId: 'u1', orgId: 'o1' }),
      '/api/ai-actions/payment-methods?customer=cus_a',
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { payment_methods: Array<{ id: string }> } };
    expect(json.data.payment_methods[0].id).toBe('pm_1');
    expect(mockListPm).toHaveBeenCalledWith('cus_a', expect.anything());
  });

  it('invalid_customer → 400', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    mockListPm.mockResolvedValue({ ok: false, code: 'invalid_customer', message: 'bad' });
    const res = await get(
      makeApp({ userId: 'u1', orgId: 'o1' }),
      '/api/ai-actions/payment-methods?customer=nope',
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('invalid_customer');
  });

  it('lookup_failed → 502 (upstream Stripe error)', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    mockListPm.mockResolvedValue({ ok: false, code: 'lookup_failed', message: 'down' });
    const res = await get(
      makeApp({ userId: 'u1', orgId: 'o1' }),
      '/api/ai-actions/payment-methods?customer=cus_a',
    );
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('lookup_failed');
  });
});

describe('GET /api/ai-actions/customers', () => {
  beforeEach(() => {
    mockIsFlagOn.mockReset();
    mockLookup.mockReset();
  });

  it('401s when unauthenticated', async () => {
    const res = await get(makeApp({}), '/api/ai-actions/customers?q=a@b.com');
    expect(res.status).toBe(401);
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it('404s when the flag is off', async () => {
    mockIsFlagOn.mockResolvedValue(false);
    const res = await get(
      makeApp({ userId: 'u1', orgId: 'o1' }),
      '/api/ai-actions/customers?q=a@b.com',
    );
    expect(res.status).toBe(404);
  });

  it('ok → 200 with the customer matches', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    mockLookup.mockResolvedValue({
      ok: true,
      customers: [{ id: 'cus_x', email: 'a@b.com', name: 'A' }],
    });
    const res = await get(
      makeApp({ userId: 'u1', orgId: 'o1' }),
      '/api/ai-actions/customers?q=a@b.com',
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { customers: Array<{ id: string }> } };
    expect(json.data.customers[0].id).toBe('cus_x');
    expect(mockLookup).toHaveBeenCalledWith('a@b.com', expect.anything());
  });

  it('invalid_query → 400', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    mockLookup.mockResolvedValue({ ok: false, code: 'invalid_query', message: 'bad' });
    const res = await get(
      makeApp({ userId: 'u1', orgId: 'o1' }),
      '/api/ai-actions/customers?q=words',
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('invalid_query');
  });
});
